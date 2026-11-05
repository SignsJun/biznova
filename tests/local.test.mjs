import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createLocalServer } from '../local/server.mjs';

async function start(databasePath) {
  const server=createLocalServer({databasePath});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}
async function stop(server) { await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }

test('Standalone server serves local assets, SQLite statistics and matching CSV',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'biznova-local-'));
  let server;
  try {
    const runtime=await start(join(folder,'dashboard.sqlite'));server=runtime.server;
    const get=path=>fetch(runtime.base+path);
    const page=await get('/');assert.equal(page.status,200);const html=await page.text();
    assert.ok(html.includes('BizNova'));assert.ok(!html.includes('https://'));assert.ok(!html.includes('signin'));
    const assets=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);assert.ok(assets.length>=3);
    for(const asset of [...assets,'/images/insulated-bottle.png','/images/sport-bottle.png','/images/travel-cup.png']){
      assert.ok(asset.startsWith('/'));const r=await get(asset);assert.equal(r.status,200);await r.arrayBuffer();
    }
    const health=await (await get('/api/health')).json();assert.equal(health.runtime,'local-node');assert.equal(health.database,'connected');
    const dashboard=await (await get('/api/dashboard')).json();assert.equal(dashboard.summary.revenue,18612.85);assert.equal(dashboard.summary.orders,915);
    const meta=await (await get('/api/dashboard?platform=meta')).json();assert.equal(meta.summary.adSpend,689.72);assert.equal(meta.platforms.length,1);
    const csvResponse=await get('/api/dashboard/export');assert.equal(csvResponse.status,200);assert.ok(csvResponse.headers.get('content-disposition').includes('.csv'));
    const rows=(await csvResponse.text()).split('\r\n').slice(1);assert.equal(rows.length,30);assert.equal(Math.round(rows.reduce((n,row)=>n+Number(row.split(',')[1]),0)*100),1861285);
    for(const path of ['/api/dashboard?from=2026-02-30','/api/dashboard?platform=invalid'])assert.equal((await get(path)).status,400);
    assert.equal((await get('/api/unknown')).status,404);
    assert.equal((await get('/..%2f..%2fpackage.json')).status,404);
    assert.equal((await fetch(runtime.base+'/api/dashboard',{method:'POST'})).status,405);
  } finally {if(server)await stop(server);await rm(folder,{recursive:true,force:true});}
});

test('SQLite records survive restarts and seed data is not reinserted',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'biznova-restart-')),filename=join(folder,'dashboard.sqlite');
  let server;
  try {
    let runtime=await start(filename);server=runtime.server;
    await stop(server);server=null;
    const db=new DatabaseSync(filename);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM product_daily').get().count,540);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ad_daily').get().count,180);
    db.prepare("UPDATE product_daily SET revenue_cents = revenue_cents + 123 WHERE date = '2026-10-11' AND product = 'insulated' AND platform = 'meta'").run();db.close();
    runtime=await start(filename);server=runtime.server;
    const data=await (await fetch(runtime.base+'/api/dashboard')).json();assert.equal(data.summary.revenue,18614.08);
    const reopened=new DatabaseSync(filename);assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM product_daily').get().count,540);assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM _local_migrations').get().count,1);reopened.close();
  } finally {if(server)await stop(server);await rm(folder,{recursive:true,force:true});}
});
