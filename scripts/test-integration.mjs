import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

// Tests never read .env and never use a supplied production/test database URL.
// All cluster files and Unix sockets stay under this repository's ignored .cache.
const cache = resolve(".cache");
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(resolve(cache, "postgres-test-"));
const socket = await mkdtemp(resolve(cache, "pg-socket-"));
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); });
});
const password = randomBytes(24).toString("hex");
const pg = new EmbeddedPostgres({ databaseDir: directory, user: "festgo_test", password, port, persistent: true,
  createPostgresUser: false, postgresFlags: ["-h", "127.0.0.1", "-k", socket], onLog: () => {}, onError: () => {} });
function run(command, args, env) {
  return new Promise((resolveRun, reject) => { const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject); child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code}).`))); });
}
let started = false;
let failed = false;
try {
  await pg.initialise(); await pg.start(); started = true;
  const files = process.argv.slice(2);
  const tests = files.length ? files : ["src/integration/sms-flow.test.ts", "src/integration/checkout-safety.test.ts", "src/integration/wipay-flow.test.ts", "src/integration/integrated-gateway-test.test.ts", "src/integration/production-flows.test.ts", "src/integration/private-wipay-probe.test.ts", "src/integration/refund-flow.test.ts"];
  for (let index = 0; index < tests.length; index++) {
    const database = `festgo_test_${index}`; await pg.createDatabase(database);
    const url = `postgresql://festgo_test:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, FESTGO_ISOLATED_TEST: "true", AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
      CRON_SECRET: "isolated-local-test-cron-secret-32-characters", PUBLIC_BASE_URL: "http://localhost:3000", APP_URL: "http://localhost:3000",
      CHECKOUT_REQUIRE_OTP: "true", KUKUGEST_ENABLED: "false", ZIETT_API_KEY: "", ZIETT_SMS_REMITTER_ID: "" };
    console.log(`Local PostgreSQL: migrating isolated suite ${tests[index]}`);
    await run("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
    await run("node", ["prisma/seed.mjs"], env);
    await run("node", ["node_modules/vitest/vitest.mjs", "run", tests[index]], env);
  }
} catch (error) { console.error(error.message); failed = true; }
finally { if (started) await pg.stop(); }
if (failed) process.exit(1);
