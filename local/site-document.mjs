import {isDeepStrictEqual} from 'node:util';

export class SiteDocumentError extends Error {
  constructor(message){super(message);this.name='SiteDocumentError';}
}
const fail=message=>{throw new SiteDocumentError(message);};
const ID=/^[a-z][a-z0-9-]{0,47}$/;
const SLUG=/^\/[a-z][a-z0-9-]{0,39}$/;
const LINK=/^(?:#[a-z][a-z0-9-]{0,47}|\/(?:[a-z][a-z0-9-]{0,39})?(?:#[a-z][a-z0-9-]{0,47})?)$/;
const SECRET=/\bsk-[a-zA-Z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-zA-Z0-9_.~-]{16,}/i;
const RESERVED=new Set(['/api','/data','/public','/assets']);
const SECTION_LIMITS={eyebrow:140,title:220,body:2000,buttonLabel:70,buttonHref:100};
const ITEM_LIMITS={title:140,body:1000,label:80,href:100};
export const SECTION_CATALOG=Object.freeze([
  {type:'hero',layouts:['split','centered','banner'],description:'One main heading with a focused introduction and optional call to action.'},
  {type:'features',layouts:['grid','list','alternating'],description:'Services, benefits or collections. Vary card and row layouts to create rhythm.'},
  {type:'content',layouts:['split','centered','alternating'],description:'Editorial narrative, story or explanation with original local artwork.'},
  {type:'faq',layouts:['list','grid'],description:'Questions and answers using native expandable details.'},
  {type:'cta',layouts:['centered','split','banner'],description:'A distinct next step with one clear internal destination.'},
  {type:'contact',layouts:['split','centered'],description:'An inquiry form backed by the existing local SQLite service.'},
  {type:'pricing',layouts:['grid','list'],description:'Offer comparison. Only use user-supplied pricing; otherwise describe plans without fabricated prices.'},
  {type:'gallery',layouts:['grid','alternating'],description:'Collections or projects illustrated with original local CSS/SVG artwork.'},
  {type:'metrics',layouts:['grid','list','banner'],description:'User-supplied facts or process milestones. Never invent performance figures.'},
]);
const TYPES=SECTION_CATALOG.map(s=>s.type);
const LAYOUTS=['split','centered','grid','list','alternating','banner'];
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const string=maxLength=>({type:'string',minLength:1,maxLength});
const linkSchema={type:'string',maxLength:100,pattern:LINK.source};
const itemSchema=object({title:string(140),body:string(1000),label:string(80),href:linkSchema},['title']);
const sectionProperties={id:{type:'string',pattern:ID.source},type:{type:'string',enum:TYPES},layout:{type:'string',enum:LAYOUTS},eyebrow:string(140),title:string(220),body:string(2000),buttonLabel:string(70),buttonHref:linkSchema,items:{type:'array',maxItems:12,items:itemSchema}};
const sectionSchema=object(sectionProperties,['id','type','layout']);
const changesSchema=object(Object.fromEntries(Object.entries(sectionProperties).filter(([key])=>key!=='id')));
const tool=(name,description,parameters)=>({type:'function',function:{name,description,parameters}});
export const DOCUMENT_TOOLS=Object.freeze([
  tool('add_page','Add an empty page. The first document edit migrates the legacy home page without rewriting its copy. Add sections before finishing.',object({id:{type:'string',pattern:ID.source},slug:{type:'string',pattern:SLUG.source},title:string(140)},['id','slug','title'])),
  tool('update_page','Change a page title or slug. Home keeps slug /. Repair navigation if a slug changes.',object({pageId:string(48),title:string(140),slug:string(41)},['pageId'])),
  tool('remove_page','Remove a non-home page. Repair any links that pointed to it.',object({pageId:string(48)},['pageId'])),
  tool('add_section','Insert a typed component into a page at an optional zero-based position. Read the component catalog and existing page first.',object({pageId:string(48),section:sectionSchema,index:{type:'integer',minimum:0,maximum:12}},['pageId','section'])),
  tool('update_page_section','Patch a component by page and section ID, including its content, type or layout. IDs stay stable.',object({pageId:string(48),sectionId:string(48),changes:changesSchema},['pageId','sectionId','changes'])),
  tool('move_section','Move a component within its page to a zero-based index. Other component content stays unchanged.',object({pageId:string(48),sectionId:string(48),index:{type:'integer',minimum:0,maximum:11}},['pageId','sectionId','index'])),
  tool('remove_section','Remove a component by page and section ID. Inspect and repair any orphan links before finishing.',object({pageId:string(48),sectionId:string(48)},['pageId','sectionId'])),
]);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function assertJson(value,depth=0){
  if(depth>12)fail('Document nesting is too deep.');
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
  if(!plain(value)&&!Array.isArray(value))fail('Use plain JSON values.');
  for(const key of Object.keys(value)){
    if(['__proto__','prototype','constructor'].includes(key))fail('Unsafe object keys are not allowed.');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))fail('Use plain JSON values.');
    assertJson(descriptor.value,depth+1);
  }
}
function keys(value,allowed,required=[]){
  if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('Provide only documented fields and all required values.');
}
function text(value,max,name){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(`${name} must contain 1–${max} characters.`);
  if(SECRET.test(value))fail('Credentials are not allowed in website content.');
  if(/<\/?[a-z][^>]*>/i.test(value))fail('Use plain text, not HTML or executable markup.');
}
const identifier=(value,name)=>{if(typeof value!=='string'||!ID.test(value))fail(`${name} must be a lowercase identifier with letters, digits or hyphens.`);};
const slug=value=>{if(typeof value!=='string'||(value!=='/'&&!SLUG.test(value))||RESERVED.has(value))fail('Use / for home or a safe one-level path such as /about; system paths are reserved.');};
export function isDocumentHref(value){return typeof value==='string'&&value.length<=100&&LINK.test(value)&&!RESERVED.has(value.split('#')[0]);}
function assertSection(section){
  keys(section,Object.keys(sectionProperties),['id','type','layout']);identifier(section.id,'Section ID');
  if(['top','main-nav'].includes(section.id))fail('This section ID is reserved for the page or navigation.');
  const catalog=SECTION_CATALOG.find(item=>item.type===section.type);if(!catalog)fail('Select a supported section type.');
  if(!catalog.layouts.includes(section.layout))fail(`The ${section.type} section supports ${catalog.layouts.join(', ')} layouts.`);
  for(const [key,max]of Object.entries(SECTION_LIMITS))if(Object.hasOwn(section,key))text(section[key],max,key);
  if(section.buttonHref!==undefined&&!isDocumentHref(section.buttonHref))fail('Buttons must use safe internal page or section links.');
  if(section.items!==undefined){
    if(!Array.isArray(section.items)||section.items.length>12)fail('A section supports at most 12 items.');
    for(const item of section.items){keys(item,Object.keys(ITEM_LIMITS),['title']);for(const[key,max]of Object.entries(ITEM_LIMITS))if(Object.hasOwn(item,key))text(item[key],max,key);if(item.href!==undefined&&!isDocumentHref(item.href))fail('Item links must use safe internal page or section links.');}
  }
}
export function assertPages(pages){
  assertJson(pages);
  if(!Array.isArray(pages)||pages.length<1||pages.length>8)fail('A website must contain 1–8 pages.');
  const ids=new Set(),slugs=new Set();
  for(const page of pages){
    keys(page,['id','slug','title','sections'],['id','slug','title','sections']);identifier(page.id,'Page ID');slug(page.slug);text(page.title,140,'Page title');
    if(ids.has(page.id)||slugs.has(page.slug))fail('Page IDs and slugs must be unique.');ids.add(page.id);slugs.add(page.slug);
    if((page.id==='home')!==(page.slug==='/'))fail('The home page must have ID home and slug /.');
    if(!Array.isArray(page.sections)||page.sections.length>12)fail('Each page supports at most 12 sections.');
    const sections=new Set();for(const section of page.sections){assertSection(section);if(sections.has(section.id))fail('Section IDs must be unique within a page.');sections.add(section.id);}
  }
  if(!ids.has('home'))fail('The website must retain its home page.');
  return pages;
}

export function migrateLegacyPages(spec){
  if(spec.pages!==undefined){assertPages(spec.pages);return structuredClone(spec.pages);}
  const button=spec.ctaLabel?{buttonLabel:spec.ctaLabel,buttonHref:'#contact'}:{};
  return [{id:'home',slug:'/',title:spec.brand||'Home',sections:[
    {id:'hero',type:'hero',layout:'split',...(spec.tagline?{eyebrow:spec.tagline}:{}),title:spec.headline||spec.brand||'Welcome',...(spec.description?{body:spec.description}:{}),...button},
    {id:'services',type:'features',layout:'grid',title:spec.pageType==='toy-store'?'Explore the collections':'What we do',items:(spec.services||[]).map(item=>({title:item.title,body:item.description}))},
    {id:'about',type:'content',layout:'split',title:spec.aboutTitle||'Our story',...(spec.aboutText?{body:spec.aboutText}:{})},
    {id:'contact',type:'contact',layout:'split',title:spec.pageType==='toy-store'?'Find your next build':'Start a conversation',body:'Tell us what you have in mind.'},
  ]}];
}
const findPage=(pages,id)=>{identifier(id,'Page ID');const page=pages.find(item=>item.id===id);if(!page)fail('Page not found. Read the current site to choose an existing page ID.');return page;};
const findSection=(page,id)=>{identifier(id,'Section ID');const index=page.sections.findIndex(item=>item.id===id);if(index<0)fail('Section not found. Read the current page to choose an existing section ID.');return index;};
export function executeDocumentTool(name,args,spec){
  assertJson(args);const candidate=structuredClone(spec),pages=migrateLegacyPages(spec);let summary;
  switch(name){
    case'add_page':keys(args,['id','slug','title'],['id','slug','title']);pages.push({id:args.id,slug:args.slug,title:args.title,sections:[]});summary=`Added page ${args.id}.`;break;
    case'update_page':{keys(args,['pageId','title','slug'],['pageId']);if(args.title===undefined&&args.slug===undefined)fail('Provide a page title or slug to update.');const page=findPage(pages,args.pageId);if(args.title!==undefined)page.title=args.title;if(args.slug!==undefined)page.slug=args.slug;summary=`Updated page ${args.pageId}.`;break;}
    case'remove_page':{keys(args,['pageId'],['pageId']);findPage(pages,args.pageId);if(args.pageId==='home')fail('The home page cannot be removed.');pages.splice(pages.findIndex(p=>p.id===args.pageId),1);summary=`Removed page ${args.pageId}.`;break;}
    case'add_section':{keys(args,['pageId','section','index'],['pageId','section']);const page=findPage(pages,args.pageId),index=args.index??page.sections.length;if(!Number.isInteger(index)||index<0||index>page.sections.length)fail('Use an insertion index between zero and the current section count.');page.sections.splice(index,0,structuredClone(args.section));summary=`Added section ${args.section?.id||''} to ${args.pageId}.`;break;}
    case'update_page_section':{keys(args,['pageId','sectionId','changes'],['pageId','sectionId','changes']);keys(args.changes,Object.keys(sectionProperties).filter(k=>k!=='id'));if(!Object.keys(args.changes).length)fail('Provide at least one component field to update.');const page=findPage(pages,args.pageId),index=findSection(page,args.sectionId);page.sections[index]={...page.sections[index],...structuredClone(args.changes)};summary=`Updated section ${args.sectionId} on ${args.pageId}.`;break;}
    case'move_section':{keys(args,['pageId','sectionId','index'],['pageId','sectionId','index']);const page=findPage(pages,args.pageId),index=findSection(page,args.sectionId);if(!Number.isInteger(args.index)||args.index<0||args.index>=page.sections.length)fail('Use a destination index within the current page.');const[section]=page.sections.splice(index,1);page.sections.splice(args.index,0,section);summary=`Moved section ${args.sectionId} to position ${args.index} on ${args.pageId}.`;break;}
    case'remove_section':{keys(args,['pageId','sectionId'],['pageId','sectionId']);const page=findPage(pages,args.pageId);page.sections.splice(findSection(page,args.sectionId),1);summary=`Removed section ${args.sectionId} from ${args.pageId}.`;break;}
    default:fail('Unknown document tool.');
  }
  assertPages(pages);candidate.pages=pages;
  const changedFields=isDeepStrictEqual(spec.pages,pages)?[]:['pages'];
  return{spec:candidate,changedFields,summary:changedFields.length?summary:'No page components changed.',observation:{ok:true,summary:changedFields.length?summary:'No page components changed.',changedFields,pages:pages.map(p=>({id:p.id,slug:p.slug,title:p.title,sections:p.sections.map(s=>({id:s.id,type:s.type,layout:s.layout}))}))}};
}

export function inspectDocument(spec){
  const issues=[],add=(severity,code,message,pageId,sectionId)=>issues.push({severity,code,message,...(pageId?{pageId}:{}),...(sectionId?{sectionId}:{})});
  let pages;try{pages=migrateLegacyPages(spec);assertPages(pages);}catch(error){return{valid:false,issues:[{severity:'error',code:'invalid-document',message:error.message}],pages:[],designGuidance:[]};}
  const bySlug=new Map(pages.map(p=>[p.slug,p]));
  function checkLink(href,page,sectionId){
    if(!isDocumentHref(href)){add('error','invalid-link','Use a safe internal page or section link.',page.id,sectionId);return;}
    const [path,anchor]=href.split('#'),target=bySlug.get(path||page.slug);
    if(!target){add('error','missing-page',`Link ${href} points to a page that does not exist.`,page.id,sectionId);return;}
    if(anchor&&anchor!=='top'&&!target.sections.some(s=>s.id===anchor))add('error','missing-anchor',`Link ${href} points to a section that does not exist.`,page.id,sectionId);
  }
  for(const page of pages){
    if(!page.sections.length)add('error','empty-page','Add content before completing this page.',page.id);
    const heroes=page.sections.filter(s=>s.type==='hero');
    if(heroes.length!==1)add('error','heading-count','Each page needs exactly one hero component for its main heading.',page.id);
    for(const section of page.sections){
      if(!section.title)add('error','missing-heading','Give the section a descriptive heading.',page.id,section.id);
      if(section.buttonLabel&&!section.buttonHref)add('error','missing-button-target','A labeled button needs a destination.',page.id,section.id);
      if(section.buttonHref&&!section.buttonLabel)add('warning','missing-button-label','Give the call to action a clear text label.',page.id,section.id);
      if(section.buttonHref)checkLink(section.buttonHref,page,section.id);
      for(const item of section.items||[])if(item.href)checkLink(item.href,page,section.id);
      if(['features','faq','pricing','gallery','metrics'].includes(section.type)&&!section.items?.length)add('error','empty-items',`Add items to the ${section.type} component.`,page.id,section.id);
      if(section.type==='faq'&&section.items?.some(item=>!item.body))add('error','missing-answer','Every FAQ question needs an answer.',page.id,section.id);
      if(section.type==='hero'&&!section.body)add('warning','thin-introduction','Add a short explanation of the offer and audience.',page.id,section.id);
      if(section.type==='pricing')for(const item of section.items||[])if(!item.label)add('warning','unpriced-offer','Use only supplied prices, or explicitly label this offer as an inquiry.',page.id,section.id);
    }
    if(page.sections.length>4&&new Set(page.sections.map(s=>s.layout)).size<2)add('warning','repetitive-layout','Vary section layouts to create a deliberate visual rhythm.',page.id);
    if(page.sections[0]?.type!=='hero')add('warning','hero-order','Place the main introduction first unless the brief specifically asks otherwise.',page.id);
  }
  // Global fragment links are rooted at home by the multipage renderer.
  const home=pages.find(p=>p.id==='home');
  for(const item of spec.nav||[])checkLink(item.href,home);
  return {valid:!issues.some(i=>i.severity==='error'),issues,pages:pages.map(p=>({id:p.id,slug:p.slug,title:p.title,sectionCount:p.sections.length,sectionTypes:p.sections.map(s=>s.type)})),designGuidance:['Use one clear visual hierarchy per page.','Alternate spacious editorial sections with compact comparison or card sections.','Use supplied facts and prices only; do not fabricate proof, metrics or testimonials.','Make the next action clear and verify every internal destination.']};
}
