import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {STYLE_IDS,STYLE_CATALOG} from '../lib/studio-styles.ts';
import {normalizeSpec,DEFAULT_SPEC,renderSite,createProjectFiles} from '../local/site-generator.mjs';
import {createProject,getProject} from '../local/studio-repository.mjs';
import {handleStudioRequest} from '../local/studio-routes.mjs';

test('Nine design directions keep their identity, safe defaults and standalone content',()=>{
 assert.equal(STYLE_IDS.length,9);
 assert.deepEqual(STYLE_CATALOG.map(s=>s.id),[...STYLE_IDS]);
 const documents=new Set();
 for(const item of STYLE_CATALOG){
  const spec=normalizeSpec({brand:'A clear & original brand',style:item.id});
  assert.equal(spec.style,item.id);assert.equal(spec.accent,item.accent);
  const html=renderSite(spec);documents.add(html);
  assert.ok(html.includes(`theme-${item.id}`));assert.ok(html.includes('A clear &amp; original brand'));
  assert.ok(html.includes('class="contact-form"'));assert.ok(html.includes('name="message"'));
  assert.ok(html.includes('prefers-reduced-motion'));
  assert.ok(!/<script[^>]+src=|@import|<img[^>]+src=["']https?:/i.test(html));
  const files=createProjectFiles(spec);
  assert.equal(JSON.parse(files.find(f=>f.path==='site.json').content).style,item.id);
  assert.equal(files.find(f=>f.path==='public/index.html').content,html);
 }
 assert.equal(documents.size,9);
 assert.equal(normalizeSpec({style:'arbitrary-code'}).style,'glass');
});

test('Project-specific style previews preserve content and never persist a style change',async()=>{
 const db=new DatabaseSync(':memory:');
 const original=createProject(db,{name:'Brick & Wonder',prompt:'Create a building toy introduction.',summary:'Created.',spec:normalizeSpec({...DEFAULT_SPEC,pageType:'toy-store',brand:'Brick & Wonder',headline:'Big adventures start with little bricks.',accent:'#ffd447'})});
 const server=createServer(async(req,res)=>{if(!await handleStudioRequest(req,res,{db})){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/studio`;
 try{
  const config=await(await fetch(`${base}/config`)).json();assert.deepEqual(config.styles,[...STYLE_IDS]);
  for(const style of STYLE_IDS){
   const response=await fetch(`${base}/style-preview?style=${style}&project=${original.id}`);
   assert.equal(response.status,200);const html=await response.text();
   assert.ok(html.includes(`theme-${style}`));assert.ok(html.includes('Brick &amp; Wonder'));
   assert.ok(html.includes('Big adventures start with little bricks.'));assert.ok(html.includes('#ffd447'));
  }
  assert.deepEqual(getProject(db,original.id),original);
  assert.equal((await fetch(`${base}/style-preview?style=unknown`)).status,400);
  assert.equal((await fetch(`${base}/style-preview?style=clay&project=missing`)).status,404);
  assert.equal((await fetch(`${base}/style-preview?style=clay&project=../escape`)).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
