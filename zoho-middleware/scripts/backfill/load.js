'use strict';

/**
 * Scratch-schema loader, checks, promote gate and status — Phase 83 Plan 07 (DB-02 SC4).
 *
 * Loads normalised rows into a `scratch_*` schema ONLY — never a real table this phase
 * (D-12, T-83-07-03). Promotion into a real table is a separate, explicit, gated
 * operation proven here only against a test-created throwaway table inside a
 * Testcontainers container; this module never creates or alters anything in `public`
 * (real tables arrive via migrations in Phases 84+).
 *
 * Identifiers (schema/table/column names) ALWAYS go through client.escapeIdentifier,
 * after assertScratchSchema / spec-derived validation — never string-interpolated raw.
 * All VALUES ALWAYS go through $n placeholders (ASVS V5, T-83-07-04).
 *
 * loadScratch's `drop table if exists <schema>.<table>` + `create table` is scoped to the
 * scratch schema only and is NOT subject to D-04 (deploy-time migrations are additive
 * only) — this is throwaway rehearsal data recreated on every load, never a deployed
 * migration.
 */

var SCRATCH_SCHEMA_RE = /^scratch_[a-z0-9_]{1,40}$/;
var BATCH_SIZE = 500;

function assertScratchSchema(name) {
  if (typeof name !== 'string' || !SCRATCH_SCHEMA_RE.test(name)) {
    throw new Error(
      'invalid scratch schema name: "' + name + '" — must match ' + SCRATCH_SCHEMA_RE
    );
  }
  return name;
}

function qualify(client, schema, table) {
  return client.escapeIdentifier(schema) + '.' + client.escapeIdentifier(table);
}

function buildCreateTableSql(client, schema, spec) {
  var colDefs = spec.columns.map(function (col) {
    return client.escapeIdentifier(col.name) + ' ' + col.pgType;
  });
  colDefs.push('primary key (' + client.escapeIdentifier(spec.primaryKey) + ')');
  return 'create table ' + qualify(client, schema, spec.table) + ' (' + colDefs.join(', ') + ')';
}

// Builds one parameterised multi-row INSERT for a batch of rows (<= BATCH_SIZE).
// jsonb columns are passed as a JSON string literal cast with ::jsonb (Postgres does not
// accept a JS object as a bind param) — every other type passes the normalised value through
// unchanged (already a decimal string / ISO string / boolean / plain string per normalize.js).
function buildInsertBatch(client, qualifiedTable, spec, batch) {
  var columnIdents = spec.columns
    .map(function (col) {
      return client.escapeIdentifier(col.name);
    })
    .join(', ');

  var params = [];
  var valueGroups = batch.map(function (row) {
    var placeholders = spec.columns.map(function (col) {
      var v = row[col.name];
      if (v === undefined) v = null;
      if (col.type === 'jsonb' && v !== null) {
        v = JSON.stringify(v);
      }
      params.push(v);
      var n = params.length;
      return col.type === 'jsonb' ? '$' + n + '::jsonb' : '$' + n;
    });
    return '(' + placeholders.join(', ') + ')';
  });

  var sql =
    'insert into ' +
    qualifiedTable +
    ' (' +
    columnIdents +
    ') values ' +
    valueGroups.join(', ');

  return { sql: sql, params: params };
}

function insertBatched(client, qualifiedTable, spec, rows) {
  if (rows.length === 0) return Promise.resolve();

  var batches = [];
  for (var i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  return batches.reduce(function (chain, batch) {
    return chain.then(function () {
      var built = buildInsertBatch(client, qualifiedTable, spec, batch);
      return client.query(built.sql, built.params);
    });
  }, Promise.resolve());
}

/**
 * loadScratch(client, { schema, spec, rows }) -> { inserted }
 *
 * create schema if not exists; drop+create <schema>.<spec.table> from spec.columns'
 * pgTypes; batched parameterised INSERT (<=500 rows/statement); all in one transaction.
 * A second call REPLACES (not appends) the rows — the drop+create makes every load
 * idempotent from a clean slate.
 */
function loadScratch(client, opts) {
  opts = opts || {};
  var schema = assertScratchSchema(opts.schema);
  var spec = opts.spec;
  var rows = opts.rows || [];
  var qualifiedTable = qualify(client, schema, spec.table);

  return client
    .query('BEGIN')
    .then(function () {
      return client.query('create schema if not exists ' + client.escapeIdentifier(schema));
    })
    .then(function () {
      return client.query('drop table if exists ' + qualifiedTable);
    })
    .then(function () {
      return client.query(buildCreateTableSql(client, schema, spec));
    })
    .then(function () {
      return insertBatched(client, qualifiedTable, spec, rows);
    })
    .then(function () {
      return client.query('COMMIT').then(function () {
        return { inserted: rows.length };
      });
    })
    .catch(function (err) {
      return client.query('ROLLBACK').then(
        function () {
          throw err;
        },
        function () {
          throw err;
        }
      );
    });
}

// Computes the expected side of every check in JS from the same normalised rows that
// were (or will be) loaded — runChecks then compares this against one aggregate query
// per column, never trusting the load to have gone correctly.
function computeExpected(spec, rows) {
  var expected = { count: rows.length, columns: {} };

  spec.columns.forEach(function (col) {
    var nonNull = [];
    var nullCount = 0;
    rows.forEach(function (row) {
      var v = row[col.name];
      if (v === null || v === undefined) {
        nullCount++;
      } else {
        nonNull.push(v);
      }
    });

    var colExpected = { nullCount: nullCount };

    if (col.type === 'id' || col.type === 'text') {
      if (nonNull.length > 0) {
        var sortedText = nonNull.slice().sort();
        colExpected.min = sortedText[0];
        colExpected.max = sortedText[sortedText.length - 1];
      }
    } else if (col.type === 'timestamptz') {
      if (nonNull.length > 0) {
        var sortedTs = nonNull.slice().sort();
        colExpected.min = sortedTs[0];
        colExpected.max = sortedTs[sortedTs.length - 1];
      }
    } else if (col.type === 'numeric') {
      if (nonNull.length > 0) {
        var nums = nonNull.map(Number);
        colExpected.min = Math.min.apply(null, nums);
        colExpected.max = Math.max.apply(null, nums);
      }
    } else if (col.type === 'boolean') {
      colExpected.trueCount = nonNull.filter(function (v) {
        return v === true;
      }).length;
    }
    // jsonb: row_count + null_count are the only checks (no meaningful min/max/true-count)

    expected.columns[col.name] = colExpected;
  });

  return expected;
}

function runColumnChecks(client, qualifiedTable, col, colExpected) {
  var colIdent = client.escapeIdentifier(col.name);
  var queries = [];

  queries.push(
    client
      .query(
        'select count(*) filter (where ' +
          colIdent +
          ' is null)::int as null_count from ' +
          qualifiedTable
      )
      .then(function (r) {
        var actual = r.rows[0].null_count;
        return {
          check: 'null_count',
          column: col.name,
          expected: colExpected.nullCount,
          actual: actual,
          ok: actual === colExpected.nullCount
        };
      })
  );

  if ((col.type === 'id' || col.type === 'text') && colExpected.min !== undefined) {
    queries.push(
      client
        .query(
          'select min(' +
            colIdent +
            ' collate "C") as min, max(' +
            colIdent +
            ' collate "C") as max from ' +
            qualifiedTable
        )
        .then(function (r) {
          var row = r.rows[0];
          return [
            {
              check: 'min',
              column: col.name,
              expected: colExpected.min,
              actual: row.min,
              ok: row.min === colExpected.min
            },
            {
              check: 'max',
              column: col.name,
              expected: colExpected.max,
              actual: row.max,
              ok: row.max === colExpected.max
            }
          ];
        })
    );
  } else if (col.type === 'timestamptz' && colExpected.min !== undefined) {
    queries.push(
      client
        .query('select min(' + colIdent + ') as min, max(' + colIdent + ') as max from ' + qualifiedTable)
        .then(function (r) {
          var row = r.rows[0];
          var minIso = row.min ? row.min.toISOString() : null;
          var maxIso = row.max ? row.max.toISOString() : null;
          return [
            {
              check: 'min',
              column: col.name,
              expected: colExpected.min,
              actual: minIso,
              ok: minIso === colExpected.min
            },
            {
              check: 'max',
              column: col.name,
              expected: colExpected.max,
              actual: maxIso,
              ok: maxIso === colExpected.max
            }
          ];
        })
    );
  } else if (col.type === 'numeric' && colExpected.min !== undefined) {
    queries.push(
      client
        .query('select min(' + colIdent + ') as min, max(' + colIdent + ') as max from ' + qualifiedTable)
        .then(function (r) {
          var row = r.rows[0];
          var minNum = row.min !== null ? Number(row.min) : null;
          var maxNum = row.max !== null ? Number(row.max) : null;
          return [
            {
              check: 'min',
              column: col.name,
              expected: colExpected.min,
              actual: minNum,
              ok: minNum === colExpected.min
            },
            {
              check: 'max',
              column: col.name,
              expected: colExpected.max,
              actual: maxNum,
              ok: maxNum === colExpected.max
            }
          ];
        })
    );
  } else if (col.type === 'boolean') {
    queries.push(
      client
        .query(
          'select count(*) filter (where ' + colIdent + ' = true)::int as true_count from ' + qualifiedTable
        )
        .then(function (r) {
          var actual = r.rows[0].true_count;
          return {
            check: 'true_count',
            column: col.name,
            expected: colExpected.trueCount,
            actual: actual,
            ok: actual === colExpected.trueCount
          };
        })
    );
  }

  return Promise.all(queries).then(function (results) {
    var flat = [];
    results.forEach(function (item) {
      if (Array.isArray(item)) {
        flat = flat.concat(item);
      } else {
        flat.push(item);
      }
    });
    return flat;
  });
}

/**
 * runChecks(client, { schema, spec, rows }) -> { ok, results: [{ check, column?, expected, actual, ok }] }
 *
 * count(*); per-column null count; min/max for id/text (COLLATE "C") and timestamptz and
 * numeric; true-count for boolean; count only for jsonb. Expected side computed in JS from
 * the same normalised rows passed in (never trusts the load).
 */
function runChecks(client, opts) {
  opts = opts || {};
  var schema = assertScratchSchema(opts.schema);
  var spec = opts.spec;
  var rows = opts.rows || [];
  var qualifiedTable = qualify(client, schema, spec.table);
  var expected = computeExpected(spec, rows);
  var results = [];

  return client
    .query('select count(*)::int as count from ' + qualifiedTable)
    .then(function (countResult) {
      var actualCount = countResult.rows[0].count;
      results.push({
        check: 'row_count',
        expected: expected.count,
        actual: actualCount,
        ok: actualCount === expected.count
      });

      var colChecks = spec.columns.map(function (col) {
        return runColumnChecks(client, qualifiedTable, col, expected.columns[col.name]);
      });

      return Promise.all(colChecks);
    })
    .then(function (colResultsArrays) {
      colResultsArrays.forEach(function (arr) {
        results = results.concat(arr);
      });
      var ok = results.every(function (r) {
        return r.ok;
      });
      return { ok: ok, results: results };
    });
}

/**
 * promote(client, { schema, spec, targetSchema = 'public' }) -> { promoted }
 *
 * Target must EXIST (to_regclass) AND be EMPTY (count(*) = 0) before anything runs —
 * `insert into target (cols) select cols from scratch` happens inside one transaction.
 * Never creates or alters the target table (real tables come from migrations in
 * Phases 84+). Preconditions are checked OUTSIDE the transaction so a precondition
 * failure never triggers a ROLLBACK-without-BEGIN and never touches the target.
 */
function promote(client, opts) {
  opts = opts || {};
  var schema = assertScratchSchema(opts.schema);
  var spec = opts.spec;
  var targetSchema = opts.targetSchema || 'public';
  var targetQualified = qualify(client, targetSchema, spec.table);
  var sourceQualified = qualify(client, schema, spec.table);
  var columnIdents = spec.columns
    .map(function (col) {
      return client.escapeIdentifier(col.name);
    })
    .join(', ');

  return client
    .query('select to_regclass($1) as reg', [targetSchema + '.' + spec.table])
    .then(function (r) {
      if (!r.rows[0].reg) {
        throw new Error('target table ' + targetSchema + '.' + spec.table + ' does not exist');
      }
      return client.query('select count(*)::int as count from ' + targetQualified);
    })
    .then(function (countResult) {
      if (countResult.rows[0].count > 0) {
        throw new Error('target table ' + targetSchema + '.' + spec.table + ' is not empty');
      }
    })
    .then(function () {
      return client
        .query('BEGIN')
        .then(function () {
          var sql =
            'insert into ' +
            targetQualified +
            ' (' +
            columnIdents +
            ') select ' +
            columnIdents +
            ' from ' +
            sourceQualified;
          return client.query(sql);
        })
        .then(function (insertResult) {
          return client.query('COMMIT').then(function () {
            return { promoted: insertResult.rowCount };
          });
        })
        .catch(function (err) {
          return client.query('ROLLBACK').then(
            function () {
              throw err;
            },
            function () {
              throw err;
            }
          );
        });
    });
}

/**
 * dbStatus(client) -> { database, migrations: [name], appMeta: {key:value}, scratchSchemas: [name] }
 */
function dbStatus(client) {
  return Promise.all([
    client.query('select current_database() as database'),
    client.query('select name from pgmigrations order by name'),
    client.query('select key, value from app_meta'),
    client.query(
      "select schema_name from information_schema.schemata where schema_name like 'scratch\\_%' escape '\\' order by schema_name"
    )
  ]).then(function (results) {
    var database = results[0].rows[0].database;
    var migrations = results[1].rows.map(function (r) {
      return r.name;
    });
    var appMeta = {};
    results[2].rows.forEach(function (r) {
      appMeta[r.key] = r.value;
    });
    var scratchSchemas = results[3].rows.map(function (r) {
      return r.schema_name;
    });
    return {
      database: database,
      migrations: migrations,
      appMeta: appMeta,
      scratchSchemas: scratchSchemas
    };
  });
}

module.exports = {
  assertScratchSchema: assertScratchSchema,
  loadScratch: loadScratch,
  runChecks: runChecks,
  promote: promote,
  dbStatus: dbStatus
};
