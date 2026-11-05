import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { handleStudioRequest, createZip } from '../local/studio-routes.mjs';
import { generateSpec, englishStudioMessage } from '../local/studio-model.mjs';

let previousProvider;
beforeEach(() => {
  previousProvider = process.env.BIZNOVA_MODEL_PROVIDER;
  process.env.BIZNOVA_MODEL_PROVIDER = 'local';
});
afterEach(() => {
  if (previousProvider === undefined) delete process.env.BIZNOVA_MODEL_PROVIDER;
  else process.env.BIZNOVA_MODEL_PROVIDER = previousProvider;
});

async function studio() {
  const db=new DatabaseSync(':memory:');
  const server=createServer(async(req,res)=>{if(!await handleStudioRequest(req,res,{db})){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,db,get:path=>fetch(base+path),post:(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),close:async()=>{await new Promise(resolve=>server.close(resolve));db.close();}};
}
const brief={prompt:'Build an English website for Northstar, a business consulting company, with services and a contact form.',style:'glass'};

test('Studio persists projects, revisions, restored versions and submitted leads',async()=>{
  const previous=process.env.BIZNOVA_OLLAMA_MODEL;delete process.env.BIZNOVA_OLLAMA_MODEL;
  const api=await studio();
  try {
    const config=await(await api.get('/api/studio/config')).json();assert.equal(config.mode,'local');assert.equal(config.model,null);assert.ok(!/[\p{Script=Han}]/u.test(JSON.stringify(config)));
    const created=await api.post('/api/studio/projects',brief);assert.equal(created.status,201);let p=await created.json();
    assert.equal(p.engine,'local');assert.equal(p.messages.length,2);assert.equal(p.versions.length,1);assert.equal(p.revision,1);
    assert.ok(p.messages[1].content.includes('no language model is connected'));assert.ok(!/[\p{Script=Han}]/u.test(p.messages[1].content));const id=p.id,originalHeadline=p.spec.headline,firstVersion=p.versions[0].id;
    const changed=await api.post(`/api/studio/projects/${id}/messages`,{message:'Change the headline to "Build a better tomorrow"; Change the CTA to "Start a conversation"; Change the accent color to #3b82f6'});assert.equal(changed.status,200);p=await changed.json();assert.equal(p.spec.headline,'Build a better tomorrow');assert.equal(p.spec.ctaLabel,'Start a conversation');assert.equal(p.spec.accent,'#3b82f6');assert.equal(p.revision,2);
    p=await(await api.post(`/api/studio/projects/${id}/messages`,{message:'Change the subtitle to "We make business growth simpler."'})).json();assert.equal(p.spec.headline,'Build a better tomorrow');assert.equal(p.spec.description,'We make business growth simpler.');
    p=await(await api.post(`/api/studio/projects/${id}/messages`,{message:'Change the about title to "Meet the team"'})).json();assert.equal(p.spec.headline,'Build a better tomorrow');assert.equal(p.spec.aboutTitle,'Meet the team');
    p=await(await api.post(`/api/studio/projects/${id}/restore`,{versionId:firstVersion})).json();assert.equal(p.spec.headline,originalHeadline);assert.equal(p.revision,5);assert.equal(p.versions.length,5);assert.ok(p.messages.every(m=>!/[\p{Script=Han}]/u.test(m.content)));
    const list=await(await api.get('/api/studio/projects')).json();assert.equal(list.projects[0].id,id);
    const preview=await api.get(`/api/studio/projects/${id}/preview`);assert.equal(preview.status,200);assert.ok((await preview.text()).includes('biznova:lead'));
    const lead=await api.post(`/api/studio/projects/${id}/leads`,{name:'Alice',email:'alice@example.com',company:'Example',message:'Please contact us about the service.',website:''},{Origin:api.base});assert.equal(lead.status,201);
    const leads=await(await api.get(`/api/studio/projects/${id}/leads`)).json();assert.equal(leads.leads.length,1);assert.equal(leads.leads[0].email,'alice@example.com');assert.ok(leads.leads[0].createdAt);
    const files=await(await api.get(`/api/studio/projects/${id}/files`)).json();assert.ok(files.files.some(f=>f.path==='server.mjs'));assert.ok(files.files.every(f=>typeof f.content==='string'));
  } finally {await api.close();if(previous===undefined)delete process.env.BIZNOVA_OLLAMA_MODEL;else process.env.BIZNOVA_OLLAMA_MODEL=previous;}
});

test('Studio validates requests, blocks cross-origin writes and leaves versions intact after model failure',async()=>{
  const previousModel=process.env.BIZNOVA_OLLAMA_MODEL,previousUrl=process.env.BIZNOVA_OLLAMA_URL;delete process.env.BIZNOVA_OLLAMA_MODEL;
  const api=await studio();
  try {
    assert.equal((await api.post('/api/studio/projects',brief,{Origin:'https://evil.example'})).status,403);
    assert.equal((await api.post('/api/studio/projects',{...brief,prompt:'x'})).status,400);
    assert.equal((await api.post('/api/studio/projects',{...brief,style:'invalid'})).status,400);
    assert.equal((await api.post('/api/studio/projects',{...brief,spec:{headline:'untrusted client spec'}})).status,400);
    assert.equal((await api.post('/api/studio/projects',{...brief,prompt:'x'.repeat(70000)})).status,413);
    const streamed=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({...brief,prompt:'x'.repeat(70000)})));controller.close();}});
    assert.equal((await fetch(api.base+'/api/studio/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:streamed,duplex:'half'})).status,413);
    assert.equal((await fetch(api.base+'/api/studio/projects',{method:'POST',body:'{}'})).status,415);
    assert.equal((await api.get('/api/studio/projects/missing')).status,404);
    const created=await(await api.post('/api/studio/projects',brief)).json();
    process.env.BIZNOVA_MODEL_PROVIDER='ollama';process.env.BIZNOVA_OLLAMA_MODEL='unit-test';process.env.BIZNOVA_OLLAMA_URL='https://external.example';
    const failed=await api.post(`/api/studio/projects/${created.id}/messages`,{message:'Make it more polished'});assert.equal(failed.status,502);
    const unchanged=await(await api.get(`/api/studio/projects/${created.id}`)).json();assert.equal(unchanged.revision,1);assert.equal(unchanged.versions.length,1);assert.equal(unchanged.messages.length,2);assert.deepEqual(unchanged.agentRuns,[]);
    assert.throws(()=>createZip([{path:'../../escape',content:'bad'}]),/Invalid export path/);
  } finally {process.env.BIZNOVA_MODEL_PROVIDER='local';await api.close();for(const [key,value] of [['BIZNOVA_OLLAMA_MODEL',previousModel],['BIZNOVA_OLLAMA_URL',previousUrl]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

function unpackStoredZip(buffer) {
  const files=[];let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28),name=buffer.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extraLength;files.push({path:name,content:buffer.subarray(start,start+size)});offset=start+size;}
  return files;
}
test('Full-stack export is a valid runnable local project without node_modules',async()=>{
  const previous=process.env.BIZNOVA_OLLAMA_MODEL;delete process.env.BIZNOVA_OLLAMA_MODEL;
  const api=await studio(),folder=await mkdtemp(join(tmpdir(),'biznova-export-'));let child;
  try {
    const p=await(await api.post('/api/studio/projects',brief)).json(),response=await api.get(`/api/studio/projects/${p.id}/export`);
    assert.equal(response.status,200);assert.ok(response.headers.get('content-disposition').includes('.zip'));
    const zip=Buffer.from(await response.arrayBuffer());assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
    const files=unpackStoredZip(zip);assert.ok(files.some(f=>f.path==='website/server.mjs'));assert.ok(files.some(f=>f.path==='website/README.md'));
    let central=zip.readUInt32LE(zip.length-6),foundLauncher=false;while(zip.readUInt32LE(central)===0x02014b50){const nameLength=zip.readUInt16LE(central+28),extraLength=zip.readUInt16LE(central+30),commentLength=zip.readUInt16LE(central+32),name=zip.subarray(central+46,central+46+nameLength).toString();if(name.endsWith('.command')){assert.ok((zip.readUInt32LE(central+38)>>>16)&0o100);foundLauncher=true;}central+=46+nameLength+extraLength+commentLength;}assert.ok(foundLauncher);
    for(const file of files){const destination=join(folder,file.path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,file.content);}
    // Node can bind port 0; the generated app prints its actual local URL.
    child=spawn(process.execPath,['server.mjs'],{cwd:join(folder,'website'),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
    let output='';const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Generated server did not start: ${output}`)),6000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Generated server exited ${code}: ${output}`));});});
    const page=await fetch(base);assert.equal(page.status,200);assert.ok((await page.text()).includes(p.spec.brand));
    const lead=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Export visitor',email:'visitor@example.com',message:'A contact from the exported site.'})});assert.equal(lead.status,201);
  } finally {if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit').catch(()=>{});}await api.close();await rm(folder,{recursive:true,force:true});if(previous===undefined)delete process.env.BIZNOVA_OLLAMA_MODEL;else process.env.BIZNOVA_OLLAMA_MODEL=previous;}
});


test('English edit instructions update the intended fields and keep assistant output in English',async()=>{
  const previous=process.env.BIZNOVA_OLLAMA_MODEL;delete process.env.BIZNOVA_OLLAMA_MODEL;
  try{
    let result=await generateSpec({prompt:brief.prompt,style:'glass'}),spec=result.spec;
    const changes=[
      ['Change the headline to "Make good business happen."','headline','Make good business happen.'],
      ['Change the brand to Northstar','brand','Northstar'],
      ['Change the CTA to "Book a consultation"','ctaLabel','Book a consultation'],
      ['Change the footer to "Made with intention."','footer','Made with intention.'],
      ['Change the about heading to "Meet the people behind the work."','aboutTitle','Meet the people behind the work.'],
      ['Change the description to "Thoughtful work for ambitious teams."','description','Thoughtful work for ambitious teams.'],
    ];
    for(const [prompt,key,value] of changes){result=await generateSpec({prompt,current:spec});spec=result.spec;assert.equal(spec[key],value);assert.ok(!/[\p{Script=Han}]/u.test(result.summary));}
    assert.equal(spec.headline,'Make good business happen.');
    result=await generateSpec({prompt:'Change the accent color to #f97316',current:spec});spec=result.spec;assert.equal(spec.accent,'#f97316');
    result=await generateSpec({prompt:'Change the navigation to Services, About, Contact',current:spec});spec=result.spec;assert.deepEqual(spec.nav.map(item=>item.label),['Services','About','Contact']);
    assert.equal(spec.accent,'#f97316');
    result=await generateSpec({prompt:'Please implement something entirely different',current:spec});assert.ok(!/[\p{Script=Han}]/u.test(result.summary));assert.ok(result.summary.includes('No language model is connected'));
  }finally{if(previous===undefined)delete process.env.BIZNOVA_OLLAMA_MODEL;else process.env.BIZNOVA_OLLAMA_MODEL=previous;}
});

test('Legacy generated messages are presented in English without rewriting stored conversations',async()=>{
  const previous=process.env.BIZNOVA_OLLAMA_MODEL;delete process.env.BIZNOVA_OLLAMA_MODEL;
  const api=await studio();
  try{
    const project=await(await api.post('/api/studio/projects',brief)).json();
    const oldSummary='已通过本地构建规则更新：视觉风格、品牌配色。当前未连接大模型；可在预览中检查，或导出完整本地项目。';
    api.db.prepare("UPDATE studio_messages SET content = ? WHERE project_id = ? AND role = 'assistant'").run(oldSummary,project.id);
    const presented=await(await api.get(`/api/studio/projects/${project.id}`)).json();
    assert.ok(presented.messages[1].content.includes('visual style, brand colors'));assert.ok(!/[\p{Script=Han}]/u.test(presented.messages[1].content));
    assert.equal(api.db.prepare("SELECT content FROM studio_messages WHERE project_id = ? AND role = 'assistant'").get(project.id).content,oldSummary);
    const userMessage={id:'original',role:'user',content:'这是用户原来的业务内容。'};assert.deepEqual(englishStudioMessage(userMessage),userMessage);
    assert.equal(englishStudioMessage({role:'user',content:'恢复版本 2'}).content,'Restore version 2');
    assert.equal(englishStudioMessage({role:'assistant',content:'已恢复第 2 版，并保存为新版本；历史版本仍然保留。'}).content,'Restored version 2 and saved it as a new version. Your previous versions are still available.');
  }finally{await api.close();if(previous===undefined)delete process.env.BIZNOVA_OLLAMA_MODEL;else process.env.BIZNOVA_OLLAMA_MODEL=previous;}
});
