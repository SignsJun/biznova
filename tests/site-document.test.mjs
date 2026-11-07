import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTION_CATALOG,DOCUMENT_TOOLS,SiteDocumentError,assertPages,migrateLegacyPages,executeDocumentTool,inspectDocument,isDocumentHref} from '../local/site-document.mjs';

const legacy=()=>({brand:'Original & Co.',tagline:'Considered ideas',headline:'Build with intention.',description:'A clear description.',ctaLabel:'Contact us',services:[{title:'Strategy',description:'A considered direction.'}],aboutTitle:'Our story',aboutText:'An original team.',nav:[{label:'Services',href:'#services'},{label:'About',href:'#about'},{label:'Contact',href:'#contact'}],footer:'Original footer.',style:'minimal',accent:'#222222'});
const hero=(id='intro')=>({id,type:'hero',layout:'centered',title:'A new perspective.',body:'A clear explanation.'});
const secondary=()=>({id:'work',slug:'/work',title:'Our work',sections:[hero()]});
const invalid=fn=>assert.throws(fn,error=>error instanceof SiteDocumentError);

test('Legacy migration preserves every authored field and does not mutate or implicitly extend the spec',()=>{
 const spec=legacy(),before=structuredClone(spec),pages=migrateLegacyPages(spec);
 assert.deepEqual(spec,before);assert.equal(Object.hasOwn(spec,'pages'),false);
 assert.deepEqual(pages[0].sections.map(s=>s.id),['hero','services','about','contact']);
 assert.equal(pages[0].sections[0].title,spec.headline);
 assert.deepEqual(pages[0].sections[1].items,[{title:'Strategy',body:'A considered direction.'}]);
 assert.equal(pages[0].sections[2].body,spec.aboutText);assert.equal(inspectDocument(spec).valid,true);
 pages[0].sections[0].title='Detached';assert.equal(spec.headline,before.headline);
});

test('Document tools add pages and real components without rewriting legacy business data',()=>{
 const spec=legacy(),before=structuredClone(spec);
 const added=executeDocumentTool('add_page',{id:'work',slug:'/work',title:'Our work'},spec);
 assert.deepEqual(spec,before);assert.deepEqual(added.changedFields,['pages']);
 assert.equal(added.spec.pages.length,2);assert.equal(added.spec.pages[1].sections.length,0);
 const built=executeDocumentTool('add_section',{pageId:'work',section:hero()},added.spec);
 assert.deepEqual({...built.spec,pages:undefined},{...before,pages:undefined});
 assert.equal(built.spec.pages[1].sections[0].title,'A new perspective.');
 assert.equal(inspectDocument(built.spec).valid,true);
});

test('Component updates and reorder preserve untouched pages and fields',()=>{
 const spec={...legacy(),pages:[...migrateLegacyPages(legacy()),secondary()]};
 const updated=executeDocumentTool('update_page_section',{pageId:'home',sectionId:'services',changes:{layout:'alternating',title:'Our expertise'}},spec);
 assert.deepEqual(updated.spec.pages[1],spec.pages[1]);
 assert.deepEqual(updated.spec.pages[0].sections.filter(s=>s.id!=='services'),spec.pages[0].sections.filter(s=>s.id!=='services'));
 assert.equal(updated.spec.pages[0].sections[1].layout,'alternating');
 const moved=executeDocumentTool('move_section',{pageId:'home',sectionId:'services',index:2},updated.spec);
 assert.deepEqual(moved.spec.pages[0].sections.map(s=>s.id),['hero','about','services','contact']);
 assert.deepEqual(moved.spec.pages[0].sections.find(s=>s.id==='services'),updated.spec.pages[0].sections[1]);
 const noop=executeDocumentTool('move_section',{pageId:'home',sectionId:'services',index:2},moved.spec);
 assert.deepEqual(noop.changedFields,[]);
});

test('Remove and rename tools leave orphan links visible to inspection for explicit repair',()=>{
 const spec={...legacy(),pages:[...migrateLegacyPages(legacy()),secondary()],nav:[{label:'Work',href:'/work'}]};
 const renamed=executeDocumentTool('update_page',{pageId:'work',title:'Selected work',slug:'/projects'},spec);
 assert.equal(renamed.spec.pages[1].title,'Selected work');assert.equal(inspectDocument(renamed.spec).valid,false);
 assert.ok(inspectDocument(renamed.spec).issues.some(i=>i.code==='missing-page'));
 const removed=executeDocumentTool('remove_section',{pageId:'home',sectionId:'contact'},spec);
 assert.ok(inspectDocument(removed.spec).issues.some(i=>i.code==='missing-anchor'&&i.sectionId==='hero'));
 const deleted=executeDocumentTool('remove_page',{pageId:'work'},spec);assert.equal(deleted.spec.pages.length,1);
 invalid(()=>executeDocumentTool('remove_page',{pageId:'home'},spec));
});

test('Page and component limits reject unsafe paths, duplicates and unsupported structures atomically',()=>{
 const spec={...legacy(),pages:migrateLegacyPages(legacy())},before=structuredClone(spec);
 for(const args of [
  {id:'home',slug:'/other',title:'Duplicate'},
  {id:'duplicate',slug:'/',title:'Duplicate home'},
  {id:'test',slug:'/api',title:'Reserved'},
  {id:'test',slug:'/nested/path',title:'Unsupported'},
  {id:'test',slug:'/../escape',title:'Unsafe'},
  {id:'Bad',slug:'/bad',title:'Invalid ID'},
 ])invalid(()=>executeDocumentTool('add_page',args,spec));
 for(const section of [hero('hero'),hero('top'),hero('main-nav'),{...hero('new'),type:'execute_shell'},{...hero('new'),layout:'grid'},{...hero('new'),html:'<script>bad</script>'},{...hero('new'),title:'<img src=x onerror=alert(1)>'},{...hero('new'),buttonHref:'https://example.com'}])invalid(()=>executeDocumentTool('add_section',{pageId:'home',section},spec));
 invalid(()=>executeDocumentTool('update_page_section',{pageId:'home',sectionId:'hero',changes:{id:'changed'}},spec));
 assert.deepEqual(spec,before);
 const many={...spec,pages:[...spec.pages,...Array.from({length:7},(_,i)=>({id:`page-${i}`,slug:`/page-${i}`,title:'Page',sections:[hero()]}))]};
 invalid(()=>executeDocumentTool('add_page',{id:'extra',slug:'/extra',title:'Extra'},many));
 const full={...spec,pages:[{...spec.pages[0],sections:Array.from({length:12},(_,i)=>({...hero(`section-${i}`),type:'content',layout:'centered'}))}]};
 invalid(()=>executeDocumentTool('add_section',{pageId:'home',section:hero('overflow')},full));
});

test('Plain JSON validation rejects prototype pollution, accessors, secrets and oversized text',()=>{
 const spec=legacy();
 invalid(()=>executeDocumentTool('add_page',JSON.parse('{"id":"work","slug":"/work","title":"Work","__proto__":{"polluted":true}}'),spec));
 let reads=0;const accessor={pageId:'home',sectionId:'hero'};Object.defineProperty(accessor,'changes',{enumerable:true,get(){reads++;return{};}});
 invalid(()=>executeDocumentTool('update_page_section',accessor,spec));assert.equal(reads,0);assert.equal({}.polluted,undefined);
 invalid(()=>executeDocumentTool('add_section',{pageId:'home',section:{...hero('secret'),title:`sk-${'x'.repeat(24)}`}},spec));
 invalid(()=>executeDocumentTool('add_section',{pageId:'home',section:{...hero('large'),body:'x'.repeat(2001)}},spec));
 invalid(()=>executeDocumentTool('execute_shell',{command:'pwd'},spec));
});

test('Inspection checks page headings, content, orphan anchors and qualified internal links',()=>{
 const pages=migrateLegacyPages(legacy());pages.push(secondary());
 pages[1].sections[0].buttonLabel='Talk to us';pages[1].sections[0].buttonHref='/#contact';
 const spec={...legacy(),pages,nav:[{label:'Work',href:'/work#intro'},{label:'Contact',href:'#contact'}]};
 assert.equal(inspectDocument(spec).valid,true);
 const broken=structuredClone(spec);broken.pages[1].sections[0].buttonHref='#contact';
 assert.ok(inspectDocument(broken).issues.some(i=>i.code==='missing-anchor'&&i.pageId==='work'));
 broken.pages[1].sections=[];assert.ok(inspectDocument(broken).issues.some(i=>i.code==='empty-page'));
 broken.pages[1].sections=[hero(),hero('second')];assert.ok(inspectDocument(broken).issues.some(i=>i.code==='heading-count'));
 broken.pages[1].sections=[hero(),{id:'offers',type:'features',layout:'grid',title:'Our offer',items:[]}];assert.ok(inspectDocument(broken).issues.some(i=>i.code==='empty-items'));
 broken.pages[1].sections[0].buttonLabel='Continue';assert.ok(inspectDocument(broken).issues.some(i=>i.code==='missing-button-target'));
 broken.pages[1].sections=[hero(),{id:'questions',type:'faq',layout:'list',title:'Questions',items:[{title:'How does it work?'}]}];
 assert.ok(inspectDocument(broken).issues.some(i=>i.code==='missing-answer'));
});

test('Link syntax and schema remain bounded and reflect the component catalog',()=>{
 for(const link of ['#contact','/#contact','/work','/work#intro','/'])assert.equal(isDocumentHref(link),true);
 for(const link of ['https://example.com','javascript:alert(1)','//example.com','/a/../b','/nested/page','/api','#','/work?query=1','/work.html'])assert.equal(isDocumentHref(link),false);
 assert.equal(DOCUMENT_TOOLS.length,7);assert.equal(SECTION_CATALOG.length,9);
 for(const definition of DOCUMENT_TOOLS){assert.equal(definition.type,'function');assert.equal(definition.function.parameters.additionalProperties,false);}
 const pages=migrateLegacyPages(legacy());assert.equal(assertPages(pages),pages);
 const duplicate=structuredClone(pages);duplicate[0].sections.push({...duplicate[0].sections[0]});invalid(()=>assertPages(duplicate));
});
