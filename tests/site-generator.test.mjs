import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { normalizeSpec, createInitialSpec, renderSite, createProjectFiles } from '../local/site-generator.mjs';

test('Website specs are bounded, escaped and constrained to safe visual tokens',()=>{
  const spec=normalizeSpec({brand:'<img src=x onerror=alert(1)>',style:'evil',accent:'red;}</style><script>alert(1)</script>',nav:[{label:'Unsafe',href:'javascript:alert(1)'}],services:[{title:'<script>bad</script>',description:'A clear description'}]});
  assert.equal(spec.style,'glass');assert.equal(spec.accent,'#b4a3ff');assert.equal(spec.nav[0].href,'#contact');
  const html=renderSite(spec);assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('aria-expanded="false"'));assert.ok(html.includes('prefers-reduced-motion'));
  for(const style of ['glass','editorial','studio'])assert.ok(renderSite({style}).includes(`theme-${style}`));
  const named=createInitialSpec('为品牌“云序”制作一个 SaaS 软件网站','editorial');assert.equal(named.locale,'en');assert.equal(named.brand,'云序');
});

test('Exported project starts without dependencies and persists validated contacts',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'biznova-generator-'));
  let process;
  try{
    const files=createProjectFiles({brand:'Test Workshop',style:'editorial'});
    for(const file of files){const path=join(folder,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content)}
    process=spawn(globalThis.process.execPath,['server.mjs'],{cwd:folder,env:{...globalThis.process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
    const base=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(new Error('Generated server timeout')),5000);process.stdout.on('data',c=>{text+=c;const match=text.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(match[0])}});process.once('exit',c=>{clearTimeout(timeout);reject(new Error('Generated server exited '+c))});process.stderr.on('data',()=>{})});
    assert.equal((await fetch(base+'/')).status,200);assert.equal((await (await fetch(base+'/api/health')).json()).database,'connected');
    const post=payload=>fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal((await post({name:'A',email:'bad',message:'hello'})).status,400);
    assert.equal((await post({name:'Alex',email:'alex@example.com',message:'Please help us build a website.'})).status,201);
    const db=new DatabaseSync(join(folder,'data','site.sqlite'));const rows=db.prepare('SELECT name,email,message FROM leads').all();assert.equal(rows.length,1);assert.equal(rows[0].name,'Alex');db.close();
    assert.equal((await fetch(base+'/data/site.sqlite')).status,404);
  }finally{if(process&&process.exitCode===null){process.kill('SIGTERM');await once(process,'exit')}await rm(folder,{recursive:true,force:true})}
});

test('English enterprise briefs preserve brand and business intent',()=>{
  const examples=[
    ['Northstar','Build an English enterprise website for Northstar. We help growing teams connect business data and automate workflows. Use a dark glass visual style, with services, about, a contact form, and a clear CTA.','glass','Connected business data'],
    ['Forma Advisory','Create an English brand consultancy website for Forma Advisory. Services include brand strategy, visual identity, and digital experiences. Use warm editorial typography, an ivory background, orange accents, and a consultation form.','editorial','Strategy & positioning'],
    ['Signal Studio','Build an English creative studio website for Signal Studio. We offer brand design, website design, and interactive experiences. Use black and electric lime, expressive typography, services, about, and a project inquiry form.','studio','Brand identity'],
  ];
  for(const [brand,prompt,style,service] of examples){
    const spec=createInitialSpec(prompt,style);assert.equal(spec.brand,brand);assert.equal(spec.locale,'en');assert.equal(spec.style,style);assert.equal(spec.services[0].title,service);assert.ok(renderSite(spec).includes('<html lang="en">'));
  }
  assert.equal(createInitialSpec('Build an English website for Northstar with a clear hero.').brand,'Northstar');
  assert.equal(createInitialSpec('给星河科技做一个中文官网').brand,'星河科技');
  assert.equal(createInitialSpec('为一家咖啡店制作一个中文网站').brand,'Slowday');
  const html=renderSite(createInitialSpec(examples[0][1]));assert.ok(html.includes('maxlength="100"'));assert.ok(html.includes('maxlength="200"'));assert.ok(html.includes('maxlength="150"'));
});


test('Generated controls, defaults and export instructions are English without altering custom content',()=>{
  const hasHan=/[\p{Script=Han}]/u;
  for(const style of ['glass','editorial','studio']){
    const spec=createInitialSpec('为一家企业制作网站，提供软件与协作服务。',style);
    assert.equal(spec.locale,'en');
    assert.ok(!hasHan.test(renderSite(spec)));
    assert.ok(createProjectFiles(spec).every(f=>!hasHan.test(f.content)), 'Default exported files must be English');
    assert.ok(!hasHan.test(renderSite({style,locale:'zh'})), 'Legacy locale flags do not switch built-in UI language');
  }
  const legacy={locale:'zh',brand:'Orbit',headline:'少一点繁杂。多一点可能。',tagline:'让团队专注真正重要的事',description:'把分散的工作流程汇聚到一个清晰的空间，让团队轻松协作、持续推进，把时间留给真正有价值的创造。',ctaLabel:'了解适合你的方案',nav:[{label:'我们能做什么',href:'#services'},{label:'合作方式',href:'#about'},{label:'联系我们',href:'#contact'}],footer:'认真思考，用心制作。一起创造下一步。'};
  const normalized=normalizeSpec(legacy);
  assert.equal(normalized.headline,'Less friction. More possibility.');assert.equal(normalized.locale,'en');
  assert.ok(!hasHan.test(renderSite(legacy)));assert.equal(legacy.headline,'少一点繁杂。多一点可能。');
  const custom={brand:'云序',headline:'用户自行编写的主标题'};
  assert.equal(normalizeSpec(custom).brand,'云序');assert.equal(normalizeSpec(custom).headline,custom.headline);
});

test('Page type is explicit, optional and does not rewrite legacy specification shapes',()=>{
  const legacy=normalizeSpec({brand:'Brick & Wonder',headline:'Build a little wonder.'});
  assert.equal(Object.hasOwn(legacy,'pageType'),false);
  assert.deepEqual(normalizeSpec(legacy),legacy);
  for(const pageType of ['business','toy-store'])assert.equal(normalizeSpec({...legacy,pageType}).pageType,pageType);
  for(const pageType of ['unknown','<script>bad</script>',null,{},false])assert.deepEqual(normalizeSpec({...legacy,pageType}),legacy);
  const normalHtml=renderSite(legacy);
  assert.equal(renderSite({...legacy,pageType:'business'}),normalHtml);
  assert.ok(!renderSite({...legacy,brand:'An independent LEGO toy store'}).includes('class="hero-art toy-hero-art"'),'Brand copy must never implicitly select a layout');
  assert.equal(createInitialSpec('Build a website for Brick & Wonder.').pageType,'business');
});

test('Toy-store introduction renders original brick artwork, collections and relevant enquiry copy',()=>{
  const input={pageType:'toy-store',brand:'Brick & Wonder',style:'studio',accent:'#f7c948',headline:'Build a little wonder.',description:'LEGO building adventures for curious minds.',services:[{title:'City adventures',description:'Build a world of your own.'},{title:'Space explorers',description:'Imagine your next mission.'},{title:'Creative vehicles',description:'Give your ideas wheels.'}],aboutTitle:'A little shop for big imaginations.',aboutText:'Find a building adventure for a curious mind.'};
  const original=structuredClone(input),html=renderSite(input,{preview:true,projectId:'toy-demo'});
  assert.deepEqual(input,original);
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('class="theme-studio toy-store"'));
  assert.ok(html.includes('FIND YOUR NEXT BUILD'));
  assert.ok(html.includes('Little bricks. Big possibilities.'));
  assert.ok(html.includes('City adventures'));
  assert.ok(html.includes('Space explorers'));
  assert.ok(html.includes('Creative vehicles'));
  assert.ok(html.includes('Original colorful building-brick city, rocket and race car'));
  for(const item of ['city','rocket','race car'])assert.ok(html.includes(`Original brick-built ${item} illustration`));
  assert.ok(html.includes('Good questions. Great builds.'));
  assert.ok(html.includes('How do I choose a set?'));
  assert.ok(html.includes('Occasion (optional)'));
  assert.ok(html.includes('What would you like to build?'));
  assert.ok(html.includes('Ask about a set'));
  for(const phrase of ['Good ideas deserve a thoughtful way forward.','A conversation is a good place to start.','Company / brand (optional)','Tell us about your business, the opportunity you see'])assert.ok(!html.includes(phrase));
  assert.ok(!/[\p{Script=Han}]/u.test(html));
  assert.ok(!/<(?:img|script|link)[^>]+(?:src|href)="https?:/i.test(html),'The page must not depend on remote image, script or stylesheet assets');
  assert.ok(html.includes('name="company"'),'The occasion label must retain the existing validated form field protocol');
  assert.ok(html.includes('biznova:lead'));
  assert.ok(html.includes('"projectId":"toy-demo"'));
  assert.ok(!html.includes('Add to cart'));
  assert.ok(!html.includes('Checkout'));
});

test('Toy-store exports contain the selected layout and work with the unchanged standalone backend',()=>{
  const files=createProjectFiles({pageType:'toy-store',brand:'Brick & Wonder',style:'editorial',accent:'#f7c948'});
  const get=path=>files.find(file=>file.path===path)?.content;
  const spec=JSON.parse(get('site.json'));
  assert.equal(spec.pageType,'toy-store');
  assert.ok(get('public/index.html').includes('class="theme-editorial toy-store"'));
  assert.ok(get('public/index.html').includes('Original colorful building-brick city, rocket and race car'));
  assert.ok(get('public/index.html').includes("'/api/leads'"));
  assert.equal(get('server.mjs'),createProjectFiles({pageType:'business'}).find(file=>file.path==='server.mjs').content,'Both layouts share the runtime verified by the standalone integration test');
  assert.ok(get('server.mjs').includes('node:sqlite'));
  assert.ok(files.every(file=>!/[\p{Script=Han}]/u.test(file.content)));
  assert.deepEqual(JSON.parse(get('package.json')).scripts,{start:'node server.mjs'});
  for(const style of ['glass','editorial','studio']){
    const html=renderSite({...spec,style});
    assert.ok(html.includes(`class="theme-${style} toy-store"`));
    assert.ok(html.includes('FIND YOUR NEXT BUILD'));
  }
});
