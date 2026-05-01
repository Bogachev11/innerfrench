/**
 * Запуск e2e: если dev уже на 3010 — только тесты; иначе поднимает dev, ждёт, тесты, завершает dev.
 * Использование: node scripts/run-e2e.cjs   или  npm run test:e2e
 */
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const DEV_URL = "http://127.0.0.1:3010";
const MAX_WAIT_MS = 120000;
const POLL_MS = 1500;
const QUICK_CHECK_MS = 4000;

function waitForServer(timeoutMs = MAX_WAIT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function tryFetch() {
      if (Date.now() > deadline) {
        reject(new Error("Server did not start in time"));
        return;
      }
      const req = http.get(DEV_URL, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => setTimeout(tryFetch, POLL_MS));
    }
    tryFetch();
  });
}

async function main() {
  let dev = null;
  try {
    await waitForServer(QUICK_CHECK_MS);
  } catch (_) {
    dev = spawn("npm", ["run", "dev"], {
      cwd: ROOT,
      stdio: "pipe",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    dev.stdout?.on("data", (d) => process.stdout.write(d));
    dev.stderr?.on("data", (d) => process.stderr.write(d));
    await waitForServer();
  }

  const pw = spawn("npx", ["playwright", "test", "--reporter=list"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PLAYWRIGHT_BASE_URL: DEV_URL },
  });
  const code = await new Promise((resolve) => pw.on("exit", (c) => resolve(c ?? 0)));
  if (dev) dev.kill("SIGTERM");
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
