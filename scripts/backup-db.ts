/**
 * Backs up the remote Supabase database to supabase/backups/.
 * Uses pg connection (no Docker). Requires SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local
 * Run before migrations: npx tsx scripts/backup-db.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!dbPassword || !url) {
  console.error("Set SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
const projectRef = url.replace("https://", "").split(".")[0];

const backupsDir = path.join(__dirname, "..", "supabase", "backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(backupsDir, `dump_${timestamp}.sql`);
fs.mkdirSync(backupsDir, { recursive: true });

async function main() {
  const pg = await import("pg").catch(() => null);
  if (!pg) {
    console.error("Install pg: npm install pg");
    process.exit(1);
  }
  const client = new (pg.default.Client)({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("Connected. Dumping public schema...");

  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const lines: string[] = ["-- Backup " + new Date().toISOString(), ""];

  for (const { tablename } of tables) {
    const { rows } = await client.query(`SELECT * FROM public."${tablename}"`);
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    for (const row of rows) {
      const vals = cols.map((c) => {
        const v = row[c];
        if (v === null) return "NULL";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "number") return String(v);
        if (v instanceof Date) return `'${v.toISOString()}'`;
        return "'" + String(v).replace(/'/g, "''") + "'";
      });
      lines.push(`INSERT INTO public."${tablename}" (${colList}) VALUES (${vals.join(", ")});`);
    }
    lines.push("");
  }
  await client.end();

  fs.writeFileSync(outFile, lines.join("\n"), "utf-8");
  console.log("Backup done:", outFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
