import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {STYLE_IDS} from '../lib/studio-styles.ts';
import {renderDocumentPage,documentPageFiles} from '../local/site-document-renderer.mjs';
import {DEFAULT_SPEC,createProjectFiles} from '../local/site-generator.mjs';

const document=()=>({...structuredClone(DEFAULT_SPEC),brand:'Brick & Wonder',style:'clay',nav:[{label:'Home',href:'/'},{label:'Collections',href:'/collections'},{label:'Contact',href:'/collections#contact'}],pages:[
 {id:'home',slug:'/',title:'Home',sections:[
  {id:'hero',type:'hero',layout:'split',eyebrow:'An independent building shop',title:'Small pieces. Big possibilities.',body:'Discover a world of creative building.',buttonLabel:'Explore collections',buttonHref:'/collections'},
  {id:'story',type:'content',layout:'alternating',title:'Room for imagination.',body:'A thoughtful place for curious minds.'},
  {id:'next',type:'cta',layout:'banner',title:'Find your next build.',buttonLabel:'Ask about a set',buttonHref:'/collections#contact'},
 ]},
 {id:'collections',slug:'/collections',title:'Collections',sections:[
  {id:'hero',type:'hero',layout:'centered',title:'A world to build.',body:'Choose your next adventure.'},
  {id:'collection-list',type:'features',layout:'alternating',title:'Discover the collections.',items:[{title:'City & everyday',body:'Stories from the world close to home.'},{title:'Space & discovery',body:'Make room for new worlds.'}]},
  {id:'questions',type:'faq',layout:'list',title:'Good questions.',items:[{title:'Can you help me choose?',body:'Tell us what the builder enjoys.'}]},
  {id:'contact',type:'contact',layout:'split',title:'A little help choosing?',body:'Tell us what you are looking for.'},
 ]},
]});

test('Document renderer preserves page order, section layout and page-specific heading hierarchy',()=>{
 const site=document();const home=renderDocumentPage(site),collections=renderDocumentPage(site,{page:'/collections'});
 assert.ok(home.includes('Small pieces. Big possibilities.'));assert.ok(!home.includes('A world to build.'));
 assert.equal((home.match(/<h1>/g)||[]).length,1);assert.equal((collections.match(/<h1>/g)||[]).length,1);
 assert.ok(home.indexOf('id="story"')<home.indexOf('id="next"'));
 assert.ok(collections.includes('data-layout="alternating"'));assert.ok(collections.includes('<article class="item"><div class="item-visual">'));assert.ok(collections.includes('<details><summary>Can you help me choose?'));
 assert.ok(home.includes('href="/collections"'));assert.ok(home.includes('href="/collections#contact"'));
 assert.equal(renderDocumentPage({...DEFAULT_SPEC}),null);
 assert.throws(()=>renderDocumentPage(site,{page:'/missing'}),error=>error.status===404);
});

test('All nine design identities support document components and optional facts or prices',()=>{
 for(const style of STYLE_IDS){
  const site=document();site.style=style;site.pages[0].sections.push(
   {id:'offers',type:'pricing',layout:'grid',title:'Ways to build.',items:[{title:'A thoughtful gift',body:'Tell us the occasion.'}]},
   {id:'principles',type:'metrics',layout:'list',title:'Our approach.',items:[{title:'Listen first',body:'Start with what matters.'}]},
   {id:'gallery',type:'gallery',layout:'grid',title:'Ideas taking shape.',items:[{title:'A new perspective',body:'Original locally drawn artwork.'}]},
  );
  const html=renderDocumentPage(site);assert.ok(html.includes(`theme-${style} document-site`));assert.ok(html.includes('Ask for details'));
  assert.ok(!html.includes('£'));assert.ok(!html.includes('$99'));assert.ok(html.includes('prefers-reduced-motion'));assert.ok(html.includes('@media(max-width:700px)'));
  assert.ok(html.includes('id="offers"'));assert.ok(html.includes('id="principles"'));assert.ok(html.includes('Original locally drawn artwork.'));
 }
});

test('Document previews route between pages, escape copy, notify the parent and initialize without a form',()=>{
 const site=document();site.pages[0].sections[0].title='Build <script>bad()</script> & share';
 const html=renderDocumentPage(site,{preview:true,projectId:'project-1'});
 assert.ok(html.includes('Build &lt;script&gt;bad()&lt;/script&gt; &amp; share'));assert.ok(!html.includes('<script>bad()'));
 assert.ok(html.includes('/api/studio/projects/project-1/preview?page=%2Fcollections#contact'));
 assert.ok(html.includes("type:'biznova:page'"));assert.ok(html.includes('"page":"/"'));
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const messages=[],window={};const parent={postMessage:(message)=>messages.push(message)};
 const mockDocument={querySelector:()=>null,querySelectorAll:()=>[]};
 new Script(script).runInNewContext({document:mockDocument,window,parent});
 assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{type:'biznova:page',projectId:'project-1',page:'/'}]);
 const form=renderDocumentPage(site,{page:'/collections',preview:true,projectId:'project-1'});
 for(const field of ['name','email','company','message','website'])assert.ok(form.includes(`name="${field}"`));
 assert.ok(form.includes("type:'biznova:lead'"));assert.ok(form.includes("event.data?.type!=='biznova:lead-result'"));
 assert.ok(form.includes("document.querySelectorAll('.contact-form').forEach"));
});

test('Document export paths are explicit, safe and static links do not retain Studio preview settings',()=>{
 const files=documentPageFiles(document(),{preview:true,projectId:'must-not-export'});
 assert.deepEqual(files.map(file=>file.path),['public/index.html','public/collections/index.html']);
 assert.ok(files.every(file=>file.content.includes('"preview":false')));
 assert.ok(files.every(file=>!file.content.includes('must-not-export')));
 const unsafe=document();unsafe.pages[1].slug='/../private';assert.throws(()=>documentPageFiles(unsafe),/Invalid document page slug/);
 const duplicate=document();duplicate.pages[1].slug='/';assert.throws(()=>documentPageFiles(duplicate),/Duplicate/);
 const empty=document();empty.pages[1].sections=[];assert.ok(renderDocumentPage(empty,{page:'collections'}).includes('ready for its first section'));
});

test('Exported multipage site serves each page and keeps the inquiry backend functional',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'biznova-multipage-'));let child;
 try{
  for(const file of createProjectFiles(document())){const path=join(folder,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content);}
  child=spawn(process.execPath,['server.mjs'],{cwd:folder,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Startup timeout')),5000);child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});});
  assert.ok((await(await fetch(base)).text()).includes('Small pieces. Big possibilities.'));
  const page=await fetch(base+'/collections');assert.equal(page.status,200);assert.ok((await page.text()).includes('A world to build.'));
  assert.equal((await fetch(base+'/missing')).status,404);assert.equal((await fetch(base+'/data/site.sqlite')).status,404);
  const response=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Document QA',email:'document@example.com',message:'A multipage inquiry test.'})});
  assert.equal(response.status,201);assert.equal((await(await fetch(base+'/api/health')).json()).status,'ok');
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(folder,{recursive:true,force:true});}
});

test('Implicit links remain valid when the document has no contact section',()=>{
 const site=document();site.nav=[{label:'Home',href:'/'},{label:'Collections',href:'/collections'}];
 for(const page of site.pages){
  page.sections=page.sections.filter(section=>section.type!=='contact');
  for(const section of page.sections){delete section.buttonHref;delete section.buttonLabel;}
 }
 const ids=new Map(site.pages.map(page=>[page.slug,new Set(['top','main-nav',...page.sections.map(section=>section.id)])]));
 for(const preview of [false,true])for(const page of site.pages){
  const html=renderDocumentPage(site,{page:page.slug,preview,projectId:'no-contact-project'});
  for(const [,raw]of html.matchAll(/href="([^"]*)"/g)){
   const link=raw.replace(/&amp;/g,'&');if(link.startsWith('mailto:'))continue;
   const url=new URL(link,'http://local.test'+page.slug);
   const target=preview&&url.pathname.endsWith('/preview')?url.searchParams.get('page'):url.pathname;
   assert.ok(ids.has(target),`${page.slug} links to missing page ${link}`);
   if(url.hash)assert.ok(ids.get(target).has(url.hash.slice(1)),`${page.slug} links to missing section ${link}`);
  }
  assert.ok(!html.includes('href="/#contact"'));
 }
});
