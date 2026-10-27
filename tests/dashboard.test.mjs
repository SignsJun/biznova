import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoData, aggregateDashboard, parseFilters, DEFAULT_FROM, DEFAULT_TO } from '../lib/dashboard-data.ts';
const records=createDemoData();
const defaults={from:DEFAULT_FROM,to:DEFAULT_TO,platform:'all'};
const aggregate=(filters=defaults)=>aggregateDashboard(records.products,records.ads,filters);
test('Figma totals reconcile across cards, calendar, products and platforms',()=>{
  const d=aggregate();
  assert.equal(d.summary.revenue,18612.85);assert.equal(d.summary.orders,915);assert.equal(d.summary.adSpend,2028.6);
  assert.equal(d.trendSummary.revenue,6869);assert.equal(d.trendSummary.orders,326);
  assert.deepEqual(d.products.map(p=>p.orders),[438,263,214]);
  assert.deepEqual(d.products.map(p=>p.revenue),[10945.62,4994.37,2672.86]);
  assert.equal(Math.round(d.calendar.reduce((a,c)=>a+c.revenue,0)*100),1861285);
  assert.equal(d.summary.bestAd.sales,2480);assert.equal(d.summary.bestAd.name,'Meta Reels');
  assert.equal(d.summary.previousRevenue,17266.4);assert.equal(d.summary.ordersChange,48);
  assert.ok(records.products.every(r=>r.orders>=0&&Number.isInteger(r.orders)&&r.revenue_cents>=0&&Number.isInteger(r.revenue_cents)));
});
test('Platform filters partition all revenue, orders and spend without loss',()=>{
  const all=aggregate(),parts=['tiktok','meta','google'].map(platform=>aggregate({...defaults,platform}));
  for (const key of ['revenue','adSpend']) assert.equal(Math.round(parts.reduce((a,p)=>a+p.summary[key],0)*100),Math.round(all.summary[key]*100));
  assert.equal(parts.reduce((a,p)=>a+p.summary.orders,0),915);
  assert.equal(parts[0].platforms.length,1);assert.equal(parts[0].summary.adSpend,912.8);
});
test('Date ranges, single days and missing data remain coherent',()=>{
  const d=aggregate({...defaults,from:'2026-10-02'});
  assert.equal(d.summary.revenue,6869);assert.equal(d.summary.orders,326);
  const single=aggregate({...defaults,from:'2026-10-09',to:'2026-10-09'});
  assert.equal(single.summary.revenue,1017);assert.equal(single.summary.orders,41);assert.equal(single.calendar.length,1);
  const empty=aggregate({from:'2027-01-01',to:'2027-01-07',platform:'all'});
  assert.equal(empty.summary.revenue,0);assert.equal(empty.summary.roas,0);assert.equal(empty.summary.revenueGrowth,null);
  assert.ok(empty.audience.every(a=>a.visitors===0));assert.equal(empty.calendar.length,7);
});
test('Invalid filters are rejected before database access',()=>{
  for(const query of ['from=bad','from=2026-02-30','from=2026-10-12&to=2026-10-01','platform=unknown','from=2024-01-01&to=2026-10-01'])assert.throws(()=>parseFilters(new URLSearchParams(query)));
  assert.deepEqual(parseFilters(new URLSearchParams()),defaults);
});
