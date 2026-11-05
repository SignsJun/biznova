import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoData } from '../lib/dashboard-data.ts';

const migrationDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));

export function openDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = db.prepare('SELECT name FROM _local_migrations WHERE name = ?');
    const recordMigration = db.prepare('INSERT INTO _local_migrations VALUES (?, ?)');
    for (const name of readdirSync(migrationDirectory).filter(n => n.endsWith('.sql')).sort()) {
      if (applied.get(name)) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(readFileSync(join(migrationDirectory, name), 'utf8'));
        recordMigration.run(name, new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (!db.prepare('SELECT id FROM dataset WHERE id = ?').get('figma-demo-v1')) {
      const records = createDemoData();
      const insertProduct = db.prepare('INSERT OR IGNORE INTO product_daily (date, product, platform, revenue_cents, orders) VALUES (?, ?, ?, ?, ?)');
      const insertAd = db.prepare('INSERT OR IGNORE INTO ad_daily (date, platform, spend_cents, sales_cents, clicks, impressions) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const r of records.products) insertProduct.run(r.date, r.product, r.platform, r.revenue_cents, r.orders);
        for (const r of records.ads) insertAd.run(r.date, r.platform, r.spend_cents, r.sales_cents, r.clicks, r.impressions);
        db.prepare('INSERT INTO dataset (id, created_at) VALUES (?, ?)').run('figma-demo-v1', new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

export function readRecords(db) {
  return {
    products: db.prepare('SELECT date, product, platform, revenue_cents, orders FROM product_daily ORDER BY date').all(),
    ads: db.prepare('SELECT date, platform, spend_cents, sales_cents, clicks, impressions FROM ad_daily ORDER BY date').all(),
  };
}
