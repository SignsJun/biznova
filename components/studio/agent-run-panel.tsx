import {CheckCircle2, AlertCircle, Wrench, ArrowUpRight} from 'lucide-react';
import {formatStudioDate} from '@/lib/studio-locale';

export type EditScope='auto'|'hero'|'services'|'about'|'footer'|'contact'|'brand'|'theme'|'navigation';
export const editScopes:{id:EditScope;label:string}[]=[
 {id:'auto',label:'Auto · Agent decides'}, {id:'hero',label:'Hero'},
 {id:'services',label:'Services'}, {id:'about',label:'About'},
 {id:'navigation',label:'Navigation'}, {id:'footer',label:'Footer'},
 {id:'theme',label:'Theme'}, {id:'brand',label:'Brand'}, {id:'contact',label:'Contact'},
];
type ToolStep={id:string;tool:string;arguments:Record<string,unknown>;ok:boolean;summary:string;durationMs:number;changedFields:string[]};
type BuildPlan={goal:string;designNotes:string;steps:string[];requiredPages?:string[];requiredSections?:{pageSlug:string;type:string}[]};
type SiteChecks={valid:boolean;issues:{severity:string;code:string;message:string;pageId?:string;sectionId?:string}[]};
export type AgentRun={id:string;revision:number;status:string;scope?:EditScope;startedAt:string;completedAt:string;modelTurns:number;model?:string;changedFields:string[];steps:ToolStep[];plan?:BuildPlan;checks?:SiteChecks};
const runStatus=(status:string)=>({completed:'Completed',partial:'Partially completed',unsupported:'Not supported',failed:'Failed'}[status]||status);

export default function AgentRunPanel({runs,onPreview}:{runs:AgentRun[];onPreview:()=>void}){
 return <section className="ws-agent-panel" aria-label="Agent tool history">
  <div className="ws-section-eyebrow">ACTIONS YOU CAN INSPECT.</div>
  <div className="ws-agent-panel-heading"><h2>A plan to follow.<br/>A clear trail.</h2><span className="ws-agent-badge"><Wrench size={12}/>TOOL CALLING</span></div>
  <p>DeepSeek plans the website, chooses tools, reads the results and decides what to do next. Inspect the plan, structural checks and actual changes for each run.</p>
  {!runs.length?<div className="ws-agent-empty"><Wrench size={25}/><strong>Your next build starts the trail.</strong><span>Build a new website or send an edit to see the agent plan pages, compose sections and check its work through tools.</span></div>:<div className="ws-agent-runs">{runs.map((run,index)=><article className="ws-agent-run" key={run.id}>
   <header><div><strong>{run.changedFields.length?'Website updated':'Website unchanged'}{index===0&&<b>Latest run</b>}</strong><span>Version {run.revision} · {formatStudioDate(run.completedAt)}{run.model&&` · ${run.model}`}</span></div><span className={`ws-agent-complete ${run.status!=='completed'?'needs-attention':''}`}>{run.status==='completed'?<CheckCircle2 size={12}/>:<AlertCircle size={12}/>} {runStatus(run.status)}</span></header>
   <div className="ws-run-meta"><span>{run.modelTurns} model turns</span><span>{run.steps.length} tool calls</span><span>Scope: {editScopes.find(s=>s.id===(run.scope||'auto'))?.label||'Auto'}</span></div>
   {run.plan&&<details className="ws-run-plan" open={index===0}><summary>Build plan</summary><strong>{run.plan.goal}</strong>{run.plan.designNotes&&<p>{run.plan.designNotes}</p>}{!!run.plan.steps?.length&&<ol>{run.plan.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>}{!!run.plan.requiredPages?.length&&<div className="ws-plan-requirements"><small>Required pages</small>{run.plan.requiredPages.map(page=><code key={page}>{page}</code>)}</div>}{!!run.plan.requiredSections?.length&&<div className="ws-plan-requirements"><small>Required sections</small>{run.plan.requiredSections.map((section,i)=><code key={i}>{section.pageSlug} · {section.type}</code>)}</div>}</details>}
   {run.checks&&<div className={`ws-run-checks ${run.checks.valid?'valid':'invalid'}`}><strong>{run.checks.valid?<CheckCircle2 size={13}/>:<AlertCircle size={13}/>} {run.checks.valid?'Structure & link checks passed':'Structure & link checks need attention'}</strong>{run.checks.issues?.length>0?<ul>{run.checks.issues.map((issue,i)=><li key={i} className={issue.severity}><span>{issue.severity}</span><p>{issue.message}</p>{issue.pageId&&<code>{issue.pageId}{issue.sectionId&&` / ${issue.sectionId}`}</code>}</li>)}</ul>:<p>No structural or internal-link issues were found.</p>}</div>}
   <div className="ws-run-changes"><small>CHANGED FIELDS</small>{run.changedFields.length?run.changedFields.map(field=><code key={field}>{field}</code>):<span>No changes were saved.</span>}</div>
   <ol className="ws-tool-steps">{run.steps.map((step,i)=><li key={step.id} className={step.ok?'':'tool-error'}><span className="ws-tool-number">{i+1}</span><div><div className="ws-tool-step-title"><code>{step.tool}</code><span>{step.ok?<CheckCircle2 size={12}/>:<AlertCircle size={12}/>} {step.ok?'Succeeded':'Returned an error'} · {step.durationMs} ms</span></div><p>{step.summary}</p>{step.changedFields.length>0&&<small>Changed: {step.changedFields.join(', ')}</small>}<details><summary>View arguments</summary><pre>{JSON.stringify(step.arguments,null,2)}</pre></details></div></li>)}</ol>
   {index===0&&<button className="ws-run-preview" onClick={onPreview}>View current website <ArrowUpRight size={13}/></button>}
  </article>)}</div>}
  <p className="ws-agent-limit-note">Tools compose pages and supported sections. Automated checks inspect structure, links and rendered HTML; they do not inspect the page in a browser. Private model reasoning is not recorded.</p>
 </section>;
}
