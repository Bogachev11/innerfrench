const path = require("path");
const { config } = require("dotenv");

config({ path: path.resolve(__dirname, "..", ".env.local") });
require("child_process").spawn(
  process.execPath,
  [path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next"), "dev", "--turbopack", "-p", process.env.PORT || "3010"],
  { stdio: "inherit", env: process.env, cwd: path.resolve(__dirname, "..") }
).on("exit", (code) => process.exit(code ?? 0));
