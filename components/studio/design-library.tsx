'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,LoaderCircle,Palette,X} from 'lucide-react';
import {STYLE_CATALOG,type StyleId,type StyleCategory} from '@/lib/studio-styles';

function StylePreview({style,projectId}:{style:StyleId;projectId?:string}){
 const frame=useRef<HTMLDivElement>(null),[width,setWidth]=useState(280);
 useEffect(()=>{const node=frame.current;if(!node)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(node);return()=>observer.disconnect();},[]);
 return <div className="ws-style-preview" ref={frame} aria-hidden="true"><iframe title={`${style} website composition`} src={`/api/studio/style-preview?style=${style}${projectId?`&project=${encodeURIComponent(projectId)}`:''}`} sandbox="" tabIndex={-1} loading="lazy" style={{width:1280,height:800,transform:`scale(${width/1280})`,transformOrigin:'top left'}}/></div>;
}

export default function DesignLibrary({style,projectId,busy,error,onApply,onClose}:{style:StyleId;projectId?:string;busy:boolean;error:string;onApply:(style:StyleId)=>Promise<boolean>;onClose:()=>void}){
 const project=!!projectId;
 const [selected,setSelected]=useState<StyleId>(style),[category,setCategory]=useState<'All'|StyleCategory>('All');
 const dialog=useRef<HTMLElement>(null);
 const close=useRef(onClose);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const focusable=()=>Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,[tabindex="0"]')||[]);
  focusable()[0]?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close.current();if(event.key==='Tab'){const list=focusable(),first=list[0],last=list[list.length-1];if(!dialog.current?.contains(document.activeElement)){event.preventDefault();first?.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 const chosen=STYLE_CATALOG.find(item=>item.id===selected)!;
 const visible=STYLE_CATALOG.filter(item=>category==='All'||item.category===category);
 const apply=async()=>{if(await onApply(selected))onClose();};
 return <div className="ws-modal-backdrop ws-library-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section ref={dialog} className="ws-style-library" role="dialog" aria-modal="true" aria-labelledby="ws-library-title" aria-describedby="ws-library-description">
   <header className="ws-library-header"><div><span className="ws-library-eyebrow"><Palette size={13}/>THE DESIGN LIBRARY</span><h2 id="ws-library-title">Different ideas. Different forms.</h2><p id="ws-library-description">Nine original compositions. Explore the navigation, hero, content layout and footer before choosing a direction.</p></div><button className="ws-icon" aria-label="Close design library" onClick={onClose}><X size={20}/></button></header>
   <div className="ws-library-filters" aria-label="Filter design styles">{(['All','Business','Creative','Commerce'] as const).map(filter=><button key={filter} disabled={busy} aria-pressed={category===filter} onClick={()=>setCategory(filter)}>{filter}<span>{filter==='All'?STYLE_CATALOG.length:STYLE_CATALOG.filter(item=>item.category===filter).length}</span></button>)}<span>{project?'Previewing your website':'Previewing sample content'}</span></div>
   <div className="ws-library-grid">{visible.map(item=><button key={item.id} className={`ws-library-card ${selected===item.id?'selected':''}`} disabled={busy} aria-label={`Preview ${item.name}, ${item.label} style`} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>
    <StylePreview style={item.id} projectId={projectId}/><div className="ws-library-card-copy"><span className="ws-library-card-top"><strong>{item.name}<small>{item.label}</small></strong><i>{selected===item.id?<Check size={13}/>:<ArrowUpRight size={13}/>}</i></span><p>{item.description}</p><span className="ws-library-tags">{item.tags.map(tag=><span key={tag}>{tag}</span>)}</span></div>
   </button>)}</div>
   <footer className="ws-library-footer"><div className="ws-library-selection"><span style={{background:chosen.accent}}/><div><strong>{chosen.name} <small>{chosen.label}</small>{selected===style&&<b>{project?'Current style':'Selected'}</b>}</strong><p>Inspired by {chosen.references.join(' · ')}</p></div><a href={`/api/studio/style-preview?style=${selected}${projectId?`&project=${encodeURIComponent(projectId)}`:''}`} target="_blank" rel="noreferrer">Full preview <ArrowUpRight size={12}/></a></div>{error&&<p className="ws-library-error" role="alert">{error}</p>}<div className="ws-library-footer-actions"><p>{busy?'The agent is applying your style. Your saved version stays available.':project?'Apply a visual direction while keeping your website content and accent color.':'Choose a visual direction, then describe the website you want to build.'}</p><button className="ws-library-apply" disabled={busy} onClick={()=>void apply()}>{busy?<><LoaderCircle size={14}/>Applying style…</>:<>{project&&selected!==style?'Apply':'Use'} {chosen.name}<ArrowUpRight size={14}/></>}</button></div></footer>
  </section>
 </div>;
}
