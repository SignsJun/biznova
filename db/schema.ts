import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
export const productDaily = sqliteTable("product_daily", {
  date: text("date").notNull(), product: text("product").notNull(), platform: text("platform").notNull(),
  revenueCents: integer("revenue_cents").notNull(), orders: integer("orders").notNull(),
}, t => [primaryKey({ columns: [t.date, t.product, t.platform] })]);
export const adDaily = sqliteTable("ad_daily", {
  date: text("date").notNull(), platform: text("platform").notNull(), spendCents: integer("spend_cents").notNull(),
  salesCents: integer("sales_cents").notNull(), clicks: integer("clicks").notNull(), impressions: integer("impressions").notNull(),
}, t => [primaryKey({ columns: [t.date, t.platform] })]);
export const dataset = sqliteTable("dataset", { id: text("id").primaryKey(), createdAt: text("created_at").notNull() });
