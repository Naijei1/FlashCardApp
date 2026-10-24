// Drop build-time mode flags before any test file runs. With
// AUTH_MODE=google, routes dynamically import next-auth, and Node's ESM
// loader fails on `next/server` (it expects `next/server.js`). Individual
// tests still opt in with stubEnv or a direct process.env assignment.
delete process.env.AUTH_MODE;
delete process.env.DATA_MODE;
