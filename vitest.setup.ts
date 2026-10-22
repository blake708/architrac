// Load .env.local so database tests can connect (Next.js does this for the app).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: unit tests still run; database tests explain what's missing.
}
