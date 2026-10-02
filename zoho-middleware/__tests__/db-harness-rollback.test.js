'use strict';

/**
 * Regression for __tests__/db/helpers/pg-harness.js rollbackEachTest() — runs in the MAIN
 * suite with a fake pool (no Docker).
 *
 * Jest 29 (jest-circus) runs afterAll hooks in DECLARATION order. db.test.js declares its
 * `pool.end()` afterAll before calling rollbackEachTest(); if the harness only released its
 * client in its own afterAll, pool.end() would run first and wait forever on the still
 * checked-out client (pg-pool only resolves end() once every client is returned) — the
 * "Exceeded timeout of 120000 ms for a hook" failure. The harness must hand the client
 * back by the end of every test, so ANY sibling afterAll sees zero checked-out clients.
 */

var rollbackEachTest = require('./db/helpers/pg-harness').rollbackEachTest;

function makeFakePool() {
  var state = { checkedOut: 0, connects: 0, queries: [] };
  return {
    state: state,
    connect: function () {
      state.checkedOut++;
      state.connects++;
      return Promise.resolve({
        query: function (sql) {
          state.queries.push(sql);
          return Promise.resolve({ rows: [] });
        },
        release: function () {
          state.checkedOut--;
        }
      });
    }
  };
}

describe('rollbackEachTest client lifecycle', function () {
  var pool = makeFakePool();

  // Declared BEFORE rollbackEachTest() — under jest-circus this runs BEFORE the harness's
  // own afterAll, exactly like db.test.js's harnessPool.end() hook.
  afterAll(function () {
    expect(pool.state.checkedOut).toBe(0);
  });

  var harness = rollbackEachTest(function () {
    return pool;
  });

  it('gives each test a client inside BEGIN', function () {
    expect(harness.client()).toBeTruthy();
    expect(pool.state.checkedOut).toBe(1);
    expect(pool.state.queries[pool.state.queries.length - 1]).toBe('BEGIN');
  });

  it('has rolled back and released the previous test client before this test starts', function () {
    expect(pool.state.queries).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN']);
    expect(pool.state.checkedOut).toBe(1);
  });
});
