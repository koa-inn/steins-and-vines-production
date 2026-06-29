'use strict';

// Per-test-file isolation for the shared admin API key env.
//
// The route guard (lib/apiKey) now resolves the UNIFIED pair
// API_SECRET_KEY || MW_API_KEY. Jest runs multiple test files in the same
// worker process, so a top-level `process.env.API_SECRET_KEY = ...` set by one
// suite would otherwise bleed into a later suite that only configures
// MW_API_KEY — making that later suite's key not match and its tests flaky.
//
// setupFiles runs once per test file BEFORE the file's module code, so clearing
// both halves here gives every file a clean slate; each file's own env
// assignments then stay scoped to that file.
delete process.env.API_SECRET_KEY;
delete process.env.MW_API_KEY;
