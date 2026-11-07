import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AUTONOMOUS_LIMITS,runWebsiteAgent} from '../local/studio-agent.mjs';
import {generateSpec} from '../local/studio-model.mjs';
import {DEFAULT_SPEC,normalizeSpec,renderSite} from '../local/site-generator.mjs';
import {createProject,getProject,reviseProject} from '../local/studio-repository.mjs';

const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const calling=(...tool_calls)=>({role:'assistant',content:null,tool_calls});
const final=(content='The requested pages are ready.')=>({role:'assistant',content});
const observations=messages=>messages.filter(m=>m.role==='tool').map(m=>({id:m.tool_call_id,...JSON.parse(m.content)}));
const seed=()=>({...normalizeSpec(DEFAULT_SPEC),brand:'Considered Studio',pages:[{id:'home',slug:'/',title:'Home',sections:[]}],nav:[{label:'Home',href:'/'}]});
const homeHero={id:'intro',type:'hero',layout:'split',title:'Make room for considered ideas.',body:'A focused practice for thoughtful digital work.',buttonLabel:'Meet the practice',buttonHref:'/about'};
const aboutHero={id:'intro',type:'hero',layout:'centered',title:'A small practice. A clear direction.',body:'We connect strategy and craft.'};
const aboutStory={id:'story',type:'content',layout:'alternating',title:'Our approach',body:'We begin by understanding the people and purpose behind each project.'};
const plan=()=>({goal:'Build a two-page studio website.',designNotes:'Use a minimal direction, deliberate hierarchy and varied section rhythm.',steps:['Compose home and about pages.','Inspect links and deliver.'],requiredPages:['/','/about'],requiredSections:[{pageSlug:'/',type:'hero'},{pageSlug:'/about',type:'hero'},{pageSlug:'/about',type:'content'}]});
const completed=()=>({status:'completed',summary:'Built and checked the home and about pages.',remaining:[]});
function script(responses){let index=0;return async(messages,tools)=>{assert.ok(tools.some(t=>t.function.name==='add_page'));const next=responses[index++];assert.ok(next,'No unplanned model turn is allowed in this test.');return typeof next==='function'?next(messages):next;};}
function buildResponses(){return[
 calling(call('plan','plan_site',plan()),call('home','add_section',{pageId:'home',section:homeHero}),call('page','add_page',{id:'about',slug:'/about',title:'About the practice'})),
 calling(call('about-hero','add_section',{pageId:'about',section:aboutHero}),call('about-story','add_section',{pageId:'about',section:aboutStory}),call('nav','update_navigation',{items:[{label:'Home',href:'/'},{label:'About',href:'/about'}]})),
 messages=>{assert.ok(observations(messages).every(o=>o.ok));return calling(call('inspect','inspect_site',{}));},
 messages=>{assert.equal(observations(messages).find(o=>o.id==='inspect').valid,true);return calling(call('finish','finish_site',completed()));},
 final(),
];}

test('An autonomous new build plans, composes actual pages, checks links and persists its accepted outcome',async()=>{
 const current=seed(),original=structuredClone(current);
 const result=await runWebsiteAgent({current,request:'Build home and about pages.',autonomous:true,initial:true,complete:script(buildResponses())});
 assert.deepEqual(current,original);assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.checks.valid,true);
 assert.deepEqual(result.spec.pages.map(p=>p.slug),['/','/about']);assert.deepEqual(result.spec.nav.map(n=>n.href),['/','/about']);
 assert.deepEqual(result.agentRun.plan,plan());assert.equal(result.agentRun.checks.browserInspection,false);assert.equal(result.agentRun.checks.renders.length,2);
 const html=renderSite(result.spec,{page:'/about'});assert.ok(html.includes('A small practice. A clear direction.'));assert.ok(!html.includes('<h1>Make room for considered ideas.</h1>'));
 const db=new DatabaseSync(':memory:');
 try{const saved=createProject(db,{name:result.spec.brand,prompt:'Build home and about pages.',...result});const loaded=getProject(db,saved.id);assert.deepEqual(loaded.spec.pages,result.spec.pages);assert.deepEqual(loaded.agentRuns[0].plan,plan());assert.deepEqual(loaded.agentRuns[0].checks,result.agentRun.checks);assert.equal(loaded.agentRuns[0].status,'completed');}finally{db.close();}
});

test('Premature completion exposes failed requirements to the model, which can repair the missing page',async()=>{
 const current=seed();current.pages[0].sections=[{...homeHero,buttonHref:'#top'}];
 const result=await runWebsiteAgent({current,request:'Add an about page.',autonomous:true,initial:true,complete:script([
  calling(call('plan','plan_site',plan()),call('too-early','finish_site',completed())),
  messages=>{const denied=observations(messages).find(o=>o.id==='too-early');assert.equal(denied.ok,false);return calling(call('page','add_page',{id:'about',slug:'/about',title:'About'}),call('hero','add_section',{pageId:'about',section:aboutHero}),call('story','add_section',{pageId:'about',section:aboutStory}));},
  calling(call('finish','finish_site',completed())),final(),
 ])});
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.checks.valid,true);
 assert.equal(result.agentRun.steps.find(s=>s.tool==='finish_site').ok,false);assert.equal(result.agentRun.steps.at(-1).ok,true);
});

test('An explicit unsupported result preserves its explanation and records a no-op without claiming completion',async()=>{
 const current=normalizeSpec(DEFAULT_SPEC);
 const outcome={status:'unsupported',summary:'Live payment processing cannot be implemented by the available component tools.',remaining:['Connect an independently implemented payment backend.']};
 const result=await runWebsiteAgent({current,request:'Implement live payments.',autonomous:true,complete:script([calling(call('unsupported','finish_site',outcome)),final('The request needs additional backend implementation.')])});
 assert.equal(result.agentRun.status,'unsupported');assert.equal(result.changed,false);assert.deepEqual(result.spec,current);assert.match(result.summary,/payment processing cannot be implemented/);assert.match(result.summary,/Remaining:/);
 const db=new DatabaseSync(':memory:');
 try{const saved=createProject(db,{prompt:'Create a draft.',spec:current,summary:'Created.'});const revised=reviseProject(db,saved,{message:'Implement live payments.',...result});assert.equal(revised.revision,saved.revision);assert.equal(revised.versions.length,saved.versions.length);assert.equal(getProject(db,saved.id).agentRuns[0].status,'unsupported');}finally{db.close();}
});

test('A partial site and unsupported page edits in a locked scope never appear as completed',async()=>{
 const current=seed();
 const incomplete=await runWebsiteAgent({current,request:'Build an about page.',autonomous:true,initial:true,complete:script([
  calling(call('plan','plan_site',plan()),call('partial','finish_site',{status:'partial',summary:'The requested about page remains unfinished.',remaining:['Build the about page.']})),
  final('This is a partial draft.'),final('The about page is still unfinished.'),
 ])});
 assert.equal(incomplete.agentRun.status,'partial');assert.equal(incomplete.agentRun.checks.valid,false);assert.ok(incomplete.agentRun.checks.issues.some(i=>i.code==='required_page'));
 const legacy=normalizeSpec(DEFAULT_SPEC);
 const locked=await runWebsiteAgent({current:legacy,request:'Add an about page while keeping the hero lock.',scope:'hero',autonomous:true,complete:script([
  calling(call('page','add_page',{id:'about',slug:'/about',title:'About'})),
  messages=>{assert.equal(observations(messages)[0].ok,false);return calling(call('unsupported','finish_site',{status:'unsupported',summary:'Adding pages requires Auto edit scope.',remaining:['Switch the edit scope to Auto.']}));},final(),
 ])});
 assert.deepEqual(locked.spec,legacy);assert.equal(locked.agentRun.status,'unsupported');assert.equal(locked.agentRun.steps[0].ok,false);
});

test('A premature final reply triggers a bounded repair opportunity, and recent decisions reach the agent',async()=>{
 const history=[{role:'user',content:'Use generous whitespace and preserve the yellow brand accent.'},{role:'assistant',content:'I will preserve the approved brand palette.'}];
 let receivedHistory=false;
 const result=await runWebsiteAgent({current:seed(),request:'Build the planned pages.',autonomous:true,initial:true,history,complete:script([
  messages=>{receivedHistory=messages.some(m=>m.role==='system'&&m.content.includes('preserve the yellow brand accent'));return final('Finished.');},
  messages=>{assert.ok(messages.at(-1).content.includes('Delivery checks found problems'));return calling(call('unsupported','finish_site',{status:'unsupported',summary:'The current run could not build the requested pages.',remaining:['Create the planned page components.']}));},final(),
 ])});
 assert.equal(receivedHistory,true);assert.equal(result.agentRun.status,'unsupported');assert.equal(result.agentRun.checks.valid,false);assert.equal(result.agentRun.modelTurns,2);
});

test('Targeted page reads and legacy headline edits keep the visible component synchronized without touching another page',async()=>{
 const current=seed();current.pages[0].sections=[{...homeHero,buttonHref:'#top'}];current.pages.push({id:'about',slug:'/about',title:'About',sections:[aboutHero,aboutStory]});
 const original=structuredClone(current),headline='A deliberate new direction.';
 const result=await runWebsiteAgent({current,request:`Change only the headline to ${headline}`,scope:'hero',autonomous:true,complete:script([
  calling(call('read','read_site',{pageId:'home',sectionId:'intro'})),
  messages=>{const read=observations(messages)[0];assert.equal(read.website.title,homeHero.title);assert.equal(read.website.sections,undefined);return calling(call('edit','update_section',{section:'hero',changes:{headline}}));},final(),
 ])});
 assert.equal(result.spec.headline,headline);assert.equal(result.spec.pages[0].sections[0].title,headline);
 assert.deepEqual(result.spec.pages[1],original.pages[1]);assert.deepEqual(current,original);
 assert.equal(result.agentRun.status,'completed');assert.equal(result.agentRun.checks.valid,true);
});

test('DeepSeek initial creation defaults to tool calling rather than one-shot structured JSON',async()=>{
 const keys=['DEEPSEEK_API_KEY','BIZNOVA_MODEL_PROVIDER','BIZNOVA_DEEPSEEK_MODEL','BIZNOVA_OLLAMA_MODEL'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),previousFetch=globalThis.fetch;
 for(const key of keys)delete process.env[key];Object.assign(process.env,{DEEPSEEK_API_KEY:'sk-autonomous-unit-test-not-real',BIZNOVA_MODEL_PROVIDER:'deepseek'});
 let index=0;const responses=buildResponses();
 globalThis.fetch=async(url,options)=>{const payload=JSON.parse(options.body);assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(payload.response_format,undefined);assert.equal(payload.tool_choice,'auto');assert.ok(payload.tools.some(t=>t.function.name==='plan_site'));assert.ok(payload.tools.some(t=>t.function.name==='add_page'));assert.ok(!options.body.includes(process.env.DEEPSEEK_API_KEY));const next=responses[index++],message=typeof next==='function'?next(payload.messages):next;return{ok:true,status:200,json:async()=>({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]})};};
 try{const result=await generateSpec({prompt:'Build an English home and about website.',name:'Considered Studio',style:'minimal'});assert.equal(result.engine,'deepseek');assert.equal(result.agentRun.status,'completed');assert.equal(result.spec.pages.length,2);assert.equal(index,4);}finally{globalThis.fetch=previousFetch;for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('A checked finish on the last autonomous turn delivers without another model request',async()=>{
 const current=normalizeSpec(DEFAULT_SPEC);let turns=0;
 const result=await runWebsiteAgent({current,request:'Update the headline and deliver.',autonomous:true,complete:async messages=>{
  turns++;
  if(turns===1)return calling(call('edit','update_section',{section:'hero',changes:{headline:'A considered new direction.'}}));
  if(turns===AUTONOMOUS_LIMITS.turns){
   assert.ok(messages.some(m=>m.role==='system'&&m.content.startsWith('Execution budget:')));
   return calling(call('finish','finish_site',completed()));
  }
  assert.ok(turns<AUTONOMOUS_LIMITS.turns,'Completion must be terminal.');
  return calling(call(`inspect-${turns}`,'inspect_site',{}));
 }});
 assert.equal(turns,AUTONOMOUS_LIMITS.turns);assert.ok(turns>12);
 assert.equal(result.agentRun.status,'completed');assert.equal(result.spec.headline,'A considered new direction.');
 assert.notEqual(current.headline,result.spec.headline);assert.equal(result.agentRun.checks.valid,true);
});

test('A mutation after finish in the same batch invalidates the outcome and must be finished again',async()=>{
 const current=normalizeSpec(DEFAULT_SPEC);
 const result=await runWebsiteAgent({current,request:'Update the headline.',autonomous:true,complete:script([
  calling(call('early-finish','finish_site',completed()),call('edit','update_section',{section:'hero',changes:{headline:'A later change in the same batch.'}})),
  calling(call('finish','finish_site',{...completed(),summary:'Checked and delivered the later headline change.'})),
 ])});
 assert.equal(result.agentRun.modelTurns,2);assert.equal(result.spec.headline,'A later change in the same batch.');
 assert.match(result.summary,/Checked and delivered the later headline change/);
});

test('Exhausting the autonomous turn budget rolls back edits and exposes bounded tool diagnostics',async()=>{
 const current=normalizeSpec(DEFAULT_SPEC),original=structuredClone(current);let turns=0;
 await assert.rejects(runWebsiteAgent({current,request:'Update the headline.',autonomous:true,complete:async()=>{
  turns++;
  if(turns===1)return calling(call('edit','update_section',{section:'hero',changes:{headline:'This must never be committed.'}}));
  return calling(call(`invalid-${turns}`,'read_site',{section:'all'}));
 }}),error=>{
  assert.match(error.message,/reached its turn limit/);
  assert.match(error.message,new RegExp(`Used ${AUTONOMOUS_LIMITS.turns} model turns`));
  assert.match(error.message,/Last tool error:/);assert.equal(error.agentRun.status,'failed');
  assert.equal(error.agentRun.steps.length,AUTONOMOUS_LIMITS.turns);return true;
 });
 assert.equal(turns,AUTONOMOUS_LIMITS.turns);assert.deepEqual(current,original);
});
