import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../config.js';

function main() {
  const config = loadConfig();
  const sqlite = new Database(config.databasePath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './drizzle' });
  console.log(`Migrations applied to ${config.databasePath}`);
  sqlite.close();
}

main();
