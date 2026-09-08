const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createGzip } = require("node:zlib");
const { pipeline } = require("node:stream/promises");
require("dotenv").config();

async function backupDatabase(directory, version) {
  if (!path.isAbsolute(directory || "") || !/^\d+\.\d+\.\d+$/.test(version || "")) {
    throw new Error("Ungültiges Backup-Ziel oder Release-Version");
  }
  const database = process.env.DATABASE;
  if (!/^[a-zA-Z0-9_]+$/.test(database || "")) throw new Error("Ungültiger Datenbankname");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `before-${version}-${Date.now()}.sql.gz`);
  const temporary = `${filename}.partial`;
  const dump = spawn("mariadb-dump", [
    "--single-transaction", "--quick", "--skip-lock-tables",
    "--host", process.env.DATABASE_SERVER || "127.0.0.1",
    "--port", process.env.DATABASE_PORT || "3306",
    "--user", process.env.DATABASE_USER,
    "--databases", database
  ], {
    env: { ...process.env, MYSQL_PWD: process.env.DATABASE_PASSWORD || "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  // Keine Zugangsdaten oder SQL-Inhalte in Deploy-Logs schreiben.
  dump.stderr.resume();
  const completion = new Promise((resolve, reject) => {
    dump.once("error", () => reject(new Error("Datenbank-Backup konnte nicht gestartet werden")));
    dump.once("close", (code) => code === 0 ? resolve() : reject(new Error("Datenbank-Backup fehlgeschlagen")));
  });
  await Promise.all([
    completion,
    pipeline(dump.stdout, createGzip(), fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }))
  ]);
  fs.renameSync(temporary, filename);
  console.log(`Datenbank gesichert: ${filename}`);
}

if (require.main === module) {
  backupDatabase(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { backupDatabase };
