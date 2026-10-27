import { env } from 'cloudflare:workers';
import { createDemoData, type ProductFact, type AdFact } from './dashboard-data';
export async function readDashboardRecords() {
  if (!env.DB) throw new Error('Dashboard database is unavailable.');
  const db=env.DB;
  const initialized=await db.prepare('SELECT id FROM dataset WHERE id = ?').bind('figma-demo-v1').first();
  if (!initialized) {
    const records=createDemoData();
    const statements=[
      ...records.products.map(r=>db.prepare('INSERT OR IGNORE INTO product_daily (date, product, platform, revenue_cents, orders) VALUES (?, ?, ?, ?, ?)').bind(r.date,r.product,r.platform,r.revenue_cents,r.orders)),
      ...records.ads.map(r=>db.prepare('INSERT OR IGNORE INTO ad_daily (date, platform, spend_cents, sales_cents, clicks, impressions) VALUES (?, ?, ?, ?, ?, ?)').bind(r.date,r.platform,r.spend_cents,r.sales_cents,r.clicks,r.impressions)),
    ];
    for (let i=0;i<statements.length;i+=80) await db.batch(statements.slice(i,i+80));
    await db.prepare('INSERT OR IGNORE INTO dataset (id, created_at) VALUES (?, ?)').bind('figma-demo-v1',new Date().toISOString()).run();
  }
  const [products,ads]=await Promise.all([
    db.prepare('SELECT date, product, platform, revenue_cents, orders FROM product_daily ORDER BY date').all<ProductFact>(),
    db.prepare('SELECT date, platform, spend_cents, sales_cents, clicks, impressions FROM ad_daily ORDER BY date').all<AdFact>(),
  ]);
  return {products:products.results,ads:ads.results};
}
