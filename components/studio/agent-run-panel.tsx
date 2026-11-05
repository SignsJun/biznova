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
export type AgentRun={id:string;revision:number;status:string;scope?:EditScope;startedAt:string;completedAt:string;modelTurns:number;model?:string;changedFields:string[];steps:ToolStep[]};

export default function AgentRunPanel({runs,onPreview}:{runs:AgentRun[];onPreview:()=>void}){
 return <section className="ws-agent-panel" aria-label="Agent tool history">
  <div className="ws-section-eyebrow">ACTIONS YOU CAN INSPECT.</div>
  <div className="ws-agent-panel-heading"><h2>Small changes.<br/>A clear trail.</h2><span className="ws-agent-badge"><Wrench size={12}/>TOOL CALLING</span></div>
  <p>DeepSeek chooses tools, reads their results and decides what to do next. Each run records the actual calls and the fields that changed.</p>
  {!runs.length?<div className="ws-agent-empty"><Wrench size={25}/><strong>Your next revision starts the trail.</strong><span>New websites start with a structured brief. Send an edit to an existing website to see the agent use its tools.</span></div>:<div className="ws-agent-runs">{runs.map((run,index)=><article className="ws-agent-run" key={run.id}>
   <header><div><strong>{run.changedFields.length?'Website updated':'Website unchanged'}{index===0&&<b>Latest run</b>}</strong><span>Version {run.revision} · {formatStudioDate(run.completedAt)}{run.model&&` · ${run.model}`}</span></div><span className="ws-agent-complete"><CheckCircle2 size={12}/>Completed</span></header>
   <div className="ws-run-meta"><span>{run.modelTurns} model turns</span><span>{run.steps.length} tool calls</span><span>Scope: {editScopes.find(s=>s.id===(run.scope||'auto'))?.label||'Auto'}</span></div>
   <div className="ws-run-changes"><small>CHANGED FIELDS</small>{run.changedFields.length?run.changedFields.map(field=><code key={field}>{field}</code>):<span>No changes were saved.</span>}</div>
   <ol className="ws-tool-steps">{run.steps.map((step,i)=><li key={step.id} className={step.ok?'':'tool-error'}><span className="ws-tool-number">{i+1}</span><div><div className="ws-tool-step-title"><code>{step.tool}</code><span>{step.ok?<CheckCircle2 size={12}/>:<AlertCircle size={12}/>} {step.ok?'Succeeded':'Returned an error'} · {step.durationMs} ms</span></div><p>{step.summary}</p>{step.changedFields.length>0&&<small>Changed: {step.changedFields.join(', ')}</small>}<details><summary>View arguments</summary><pre>{JSON.stringify(step.arguments,null,2)}</pre></details></div></li>)}</ol>
   {index===0&&<button className="ws-run-preview" onClick={onPreview}>View current website <ArrowUpRight size={13}/></button>}
  </article>)}</div>}
  <p className="ws-agent-limit-note">Tools edit supported website fields. Preview checks render HTML; they do not inspect the page in a browser. Private model reasoning is not recorded.</p>
 </section>;
}
