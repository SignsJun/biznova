import { inspectDocument, SECTION_CATALOG } from './site-document.mjs';
import { renderSite } from './site-generator.mjs';

const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string',minLength:1,maxLength:1200};
const slug={type:'string',pattern:'^/(?:[a-z][a-z0-9-]{0,47})?$'};
const tool=(name,description,parameters)=>({type:'function',function:{name,description,parameters}});
export const PLANNING_TOOLS=[
 tool('plan_site','Record the requested goal, visual direction, implementation steps and testable required pages/sections before building. Include every explicit requested page. Do not invent business facts.',object({goal:text,designNotes:text,steps:{type:'array',minItems:1,maxItems:12,items:text},requiredPages:{type:'array',minItems:1,maxItems:8,items:slug},requiredSections:{type:'array',maxItems:24,items:object({pageSlug:slug,type:{type:'string',enum:SECTION_CATALOG.map(s=>s.type)}},['pageSlug','type'])}},['goal','designNotes','steps','requiredPages','requiredSections'])),
 tool('list_sections','Inspect composable section types, layout choices and design guidance before adding or restructuring pages.',object({})),
 tool('inspect_site','Check every page, navigation target, section hierarchy and the recorded plan; render all pages. Returns actual structural errors and design warnings. This is not browser or screenshot inspection.',object({})),
 tool('finish_site','Report the outcome after inspection. completed requires all structural checks and declared page/section requirements to pass. Use partial/unsupported with a clear explanation and remaining work when necessary.',object({status:{type:'string',enum:['completed','partial','unsupported']},summary:text,remaining:{type:'array',maxItems:12,items:text}},['status','summary','remaining'])),
];

export function inspectAcceptance(spec,plan,{initial=false}={}){
 const report=spec.pages?inspectDocument(spec):{valid:true,issues:[],pages:[]};
 const issues=[...report.issues];
 const add=(code,message)=>issues.push({severity:'error',code,message});
 if(initial&&!spec.pages)add('pages_required','A new autonomous website must contain a composed home page and any requested additional pages.');
 if(initial&&!plan)add('plan_required','Record a website plan before delivering a new build.');
 for(const path of plan?.requiredPages||[])if(!spec.pages?.some(p=>p.slug===path))add('required_page',`The plan requires page ${path}.`);
 for(const requirement of plan?.requiredSections||[])if(!spec.pages?.find(p=>p.slug===requirement.pageSlug)?.sections.some(s=>s.type===requirement.type))add('required_section',`The plan requires a ${requirement.type} section on ${requirement.pageSlug}.`);
 const renders=[];
 for(const page of spec.pages||[{slug:'/'}]){
  try{const html=renderSite(spec,{preview:true,page:page.slug});if(!html.startsWith('<!doctype html>')||!html.includes('<main'))throw new Error('Invalid rendered document');renders.push({page:page.slug,htmlBytes:Buffer.byteLength(html)});}
  catch{add('render_failed',`Page ${page.slug} could not render.`);}
 }
 return {...report,valid:!issues.some(i=>i.severity==='error'),issues,renders,browserInspection:false};
}

export function validatePlan(plan){
 const keys=['goal','designNotes','steps','requiredPages','requiredSections'];
 if(!plan||typeof plan!=='object'||Array.isArray(plan)||Object.keys(plan).some(k=>!keys.includes(k))||keys.some(k=>!(k in plan)))throw new Error('Provide all documented plan fields.');
 const validText=v=>typeof v==='string'&&v.trim()&&v.length<=1200;
 const validSlug=v=>typeof v==='string'&&/^\/(?:[a-z][a-z0-9-]{0,47})?$/.test(v);
 if(!validText(plan.goal)||!validText(plan.designNotes)||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>12||!plan.steps.every(validText)||!Array.isArray(plan.requiredPages)||!plan.requiredPages.length||plan.requiredPages.length>8||!plan.requiredPages.every(validSlug)||!Array.isArray(plan.requiredSections)||plan.requiredSections.length>24||plan.requiredSections.some(r=>!r||Object.keys(r).some(k=>!['pageSlug','type'].includes(k))||!validSlug(r.pageSlug)||!SECTION_CATALOG.some(s=>s.type===r.type)))throw new Error('Use bounded plan text, supported section types and safe page slugs.');
 return structuredClone(plan);
}
