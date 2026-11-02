/**
 * Import this FIRST in any test or script that talks to MongoDB through the application's own connection code.
 *
 * It never reads .env / .env.local (which point at the real database). It points the app at a throwaway database on
 * this machine, and refuses to continue if the address is not a loopback address, so a test can never write to, or
 * delete from, production data by accident.
 *
 *   TEST_MONGODB_URI   optional; must be mongodb://127.0.0.1 or localhost (default: the local server, database
 *                      "whyte_legacy_script_tests")
 */
const uri = process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/whyte_legacy_script_tests";
const host = (uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/:,?]+)/)?.[1] ?? "").toLowerCase();

if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error("Refusing to run: this test may only use a MongoDB on this machine (127.0.0.1 / localhost).");
  process.exit(2);
}

process.env.MONGODB_URI = uri;

export const TEST_DATABASE_URI = uri;
