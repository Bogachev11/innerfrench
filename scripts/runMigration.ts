/**
 * Runs SQL migration against Supabase via Management API or pg.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "migrations", "001_schema.sql"),
    "utf-8"
  );

  // Try using Supabase's rpc to check if we can talk to the DB
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // First check: can we reach the API?
  const { error: pingErr } = await supabase.from("episodes").select("id").limit(1);
  console.log(`Ping result: ${pingErr?.message || "OK (table exists)"}`);

  if (pingErr && pingErr.code === "42P01") {
    // Table doesn't exist — need to run migration
    console.log("\nTables don't exist. Running migration via pg...");

    // Install pg on-the-fly
    const pg = await import("pg").catch(() => null);
    if (!pg) {
      console.log("\npg module not installed. Installing...");
      const { execSync } = await import("child_process");
      execSync("npm install pg", { stdio: "inherit" });
      const pg2 = await import("pg");
      await runPg(pg2, sql);
    } else {
      await runPg(pg, sql);
    }
  } else if (!pingErr) {
    console.log("Tables already exist!");
  } else {
    console.log(`Unexpected error: ${pingErr.message} (code: ${pingErr.code})`);
    console.log("Trying pg anyway...");
    const pg = await import("pg").catch(() => null);
    if (pg) await runPg(pg, sql);
  }
}

async function runPg(pg: any, sql: string) {
  // Supabase direct connection (Session mode)
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    console.error("\nSUPABASE_DB_PASSWORD not set in .env.local");
    console.error("Add: SUPABASE_DB_PASSWORD=your_password");
    console.error("\nAlternatively, run this SQL manually in Supabase Dashboard → SQL Editor:");
    console.error("--- Copy from supabase/migrations/001_schema.sql ---");
    process.exit(1);
  }

  const encodedPw = encodeURIComponent(dbPassword);
  const client = new pg.default.Client({
    host: "db.wrrlqnrvkeadawseyyyb.supabase.co",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to postgres");

  // Split and run statements
  const statements = sql.split(";").filter((s: string) => s.trim());
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      console.log(`  OK: ${stmt.trim().substring(0, 60)}...`);
    } catch (e: any) {
      if (e.message?.includes("already exists")) {
        console.log(`  SKIP: ${stmt.trim().substring(0, 60)}... (already exists)`);
      } else {
        console.error(`  ERR: ${e.message}`);
      }
    }
  }

  await client.end();
  console.log("\nMigration complete!");
}

main().catch(console.error);
