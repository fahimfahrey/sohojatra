// Stub for the `server-only` package. It throws at import time inside
// client bundles to enforce server-only modules, but Node test runners
// don't ship it. The file's contents don't matter — only that the import
// resolves.
export {};
