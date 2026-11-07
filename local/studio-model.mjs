import { STYLE_IDS, STYLE_CATALOG } from '../lib/studio-styles.ts';
import { createInitialSpec, normalizeSpec, DEFAULT_SPEC } from './site-generator.mjs';
import { runWebsiteAgent, WEBSITE_AGENT_TOOLS, WebsiteAgentProviderError, AUTONOMOUS_LIMITS } from './studio-agent.mjs';

const styles=[...STYLE_IDS];
const initialSummary='Created a website draft for your business and selected design direction, including navigation, a hero, services, an about section and a working contact form. You can preview it, save revisions and export a complete Node.js + SQLite project. This workspace currently uses local design presets and editing rules; no language model is connected.';
const supportedEdits='Your request has been recorded. No language model is connected yet. Local editing supports explicit instructions such as “Change the headline to…”, “Change the brand to…”, “Change the CTA to…”, “Change the footer to…” and “Change the navigation to Services, About, Contact”, plus style and color changes. More general requests will need the model API integration.';
const updatedSummary=changes=>`Updated ${changes.join(', ')} using local editing rules. No language model is connected yet. Review the preview or export the complete local project.`;
const modelSummary=(model,current)=>`${current?'Updated':'Created'} website content with the local ${model} model and prepared the preview and full-stack project. You can continue adjusting the copy, style or colors.`;

const deepseekEndpoint='https://api.deepseek.com/chat/completions';
const configurationError=message=>new WebsiteAgentProviderError(message);

function modelSettings() {
  const key=(process.env.DEEPSEEK_API_KEY||'').trim();
  const requested=(process.env.BIZNOVA_MODEL_PROVIDER||'').trim().toLowerCase();
  const mode=requested|| (key?'deepseek':(process.env.BIZNOVA_OLLAMA_MODEL||'').trim()?'ollama':'local');
  if(!['local','ollama','deepseek'].includes(mode))return {mode:'local',model:null,error:'BIZNOVA_MODEL_PROVIDER must be local, ollama or deepseek.'};
  if(mode==='local')return {mode,model:null};
  const model=(mode==='deepseek'?(process.env.BIZNOVA_DEEPSEEK_MODEL||'deepseek-flash'):(process.env.BIZNOVA_OLLAMA_MODEL||'')).trim();
  const valid=mode==='deepseek'?/^deepseek-[a-z0-9][a-z0-9._-]{0,63}$/.test(model):/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model);
  if(!valid||(key&&model.includes(key)))return {mode,model:null,error:mode==='deepseek'?'Configure BIZNOVA_DEEPSEEK_MODEL with a valid DeepSeek model identifier.':'Configure BIZNOVA_OLLAMA_MODEL with a valid local model identifier.'};
  if(mode==='deepseek'&&!key)return {mode,model,error:'DeepSeek is selected but DEEPSEEK_API_KEY is not configured on the local server.'};
  return {mode,model};
}

export function modelConfig() {
  const {mode,model,error}=modelSettings();
  const labels={local:'Local build engine',ollama:'Local Ollama model',deepseek:'DeepSeek API'};
  const notes={local:'No language model is connected. Design presets and explicit copy, color and style rules are available; general AI coding is not enabled.',ollama:'Requests are sent to your local Ollama service. The model produces structured website content only.',deepseek:'Requests are sent to the official DeepSeek API. The server keeps the API key private; new websites and revisions use planning, composable pages and sections, tool calling and structural acceptance checks before saving.'};
  return {mode,label:error?'Model configuration required':labels[mode],model,configured:!error,styles,styleCatalog:STYLE_CATALOG,capabilities:['website-preview','versions','fullstack-export','contact-database',...(mode==='deepseek'?['tool-calling','scoped-edits','agent-run-history','multi-page','section-composition','planning','structural-checks']:[])],...(mode==='deepseek'?{agent:{mode:'tool-calling',appliesTo:'creation-and-revisions',tools:WEBSITE_AGENT_TOOLS.map(t=>t.function.name),maxModelTurns:AUTONOMOUS_LIMITS.turns,maxToolCalls:AUTONOMOUS_LIMITS.calls}}:{}),note:error||notes[mode]};
}

// Present previously generated system messages in English without rewriting
// stored conversations or translating arbitrary user-authored content.
export function englishStudioMessage(message) {
  const isText=typeof message==='string';
  const content=isText?message:message?.content;
  if(typeof content!=='string')return message;
  const role=isText?'assistant':message.role;
  let translated=content;
  if(role==='assistant'){
    if(content.startsWith('已按企业需求和所选设计方向创建本地网站草案'))translated=initialSummary;
    else if(content.startsWith('已通过本地构建规则更新：')){
      const labels={'视觉风格':'visual style','品牌配色':'brand colors','品牌名称':'brand name','首屏标题':'hero headline','品牌介绍':'business description','行动按钮':'call-to-action text','页脚文案':'footer copy','关于区标题':'about heading','联系邮箱':'contact email','语言标记':'language setting','导航菜单':'navigation menu'};
      const changes=(content.match(/^已通过本地构建规则更新：(.+?)。/)?.[1]||'').split('、').map(label=>labels[label]).filter(Boolean);
      translated=changes.length?updatedSummary(changes):'Updated the website using local editing rules. Review the preview or export the complete project. No language model is connected yet.';
    } else if(content.startsWith('已记录你的需求。当前未连接大模型'))translated=supportedEdits;
    else if(/^已恢复第\s*\d+\s*版/.test(content)){
      const revision=content.match(/^已恢复第\s*(\d+)\s*版/)[1];
      translated=`Restored version ${revision} and saved it as a new version. Your previous versions are still available.`;
    } else if(content.startsWith('已通过本机模型 ')){
      const match=content.match(/^已通过本机模型 (.+?) (更新|生成)/);
      if(match)translated=modelSummary(match[1],match[2]==='更新');
    }
  } else if(role==='user'){
    const restored=content.match(/^恢复版本\s+(\d+)$/);
    const switched=content.match(/^将网站视觉方向切换为(折光科技|编辑美学|先锋工作室)，保留企业内容。$/);
    if(restored)translated=`Restore version ${restored[1]}`;
    else if(switched)translated=`Switch the website to the ${{'折光科技':'Prism / glass','编辑美学':'Forma / editorial','先锋工作室':'Signal / studio'}[switched[1]]} design direction and keep the business content.`;
  }
  return isText?translated:{...message,content:translated};
}

function localEdit(current,message,style) {
  const next=structuredClone(current),changes=[];
  const detected=style||styles.find(id=>new RegExp(`\\b${id}\\b`,'i').test(message))||(/玻璃|\bglass\b|科技|渐变/i.test(message)?'glass':/杂志|\beditorial\b|暖色|极简白/i.test(message)?'editorial':/工作室|\bstudio\b|霓虹|柠檬/i.test(message)?'studio':null);
  if(detected&&detected!==next.style){next.style=detected;changes.push('visual style');}
  const customColor=message.match(/#[0-9a-fA-F]{6}\b/)?.[0];
  const colors=[[/紫色|\bpurple\b/i,'#9b87f5'],[/蓝色|\bblue\b/i,'#7ca5ff'],[/绿色|\bgreen\b/i,'#83d3ac'],[/橙色|\borange\b/i,'#e98956'],[/红色|\bred\b/i,'#ed7c77'],[/黄色|\byellow\b/i,'#d4ed78']];
  const color=customColor||colors.find(([regex])=>regex.test(message))?.[1];
  if(color){next.accent=color;changes.push('brand colors');}
  const fieldPatterns=[
    ['brand',/(?:品牌(?:名|名称)?|公司(?:名|名称)?|\bbrand(?: name)?)\s*(?:改成|改为|换成|设为|设置为|叫做|叫|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;。]{1,80})/i,'brand name'],
    ['headline',/(?:主标题|(?<!副|关于)标题|\b(?:hero\s+)?headline|\bmain title)\s*(?:改成|改为|换成|设为|设置为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;]{1,220})/i,'hero headline'],
    ['description',/(?:描述|介绍|\bdescription|\bsubtitle|副标题)\s*(?:改成|改为|换成|设为|设置为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;]{1,800})/i,'business description'],
    ['ctaLabel',/(?:按钮(?:文案|文字)?|\bCTA(?: label| text)?|\bctaLabel|\bbutton(?: text| label| copy)?)\s*(?:改成|改为|换成|设为|设置为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;。]{1,60})/i,'call-to-action text'],
    ['footer',/(?:页脚|\bfooter(?: text| copy)?)\s*(?:改成|改为|换成|设为|设置为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;]{1,300})/i,'footer copy'],
    ['aboutTitle',/(?:关于标题|\babout(?: section)? (?:title|heading))\s*(?:改成|改为|换成|设为|设置为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;]{1,220})/i,'about heading'],
  ];
  for(const [field,regex,label] of fieldPatterns){const value=message.match(regex)?.[1]?.trim();if(value){next[field]=value;changes.push(label);}}
  const email=message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if(email){next.email=email;changes.push('contact email');}
  if(/英文|\benglish\b/i.test(message)&&next.locale!=='en'){next.locale='en';changes.push('language setting');}
  const nav=message.match(/(?:导航|\bnavbar|\bnavigation(?: menu)?)\s*(?:改成|改为|设为|[:：=]|to\b|is\b)\s*[“"「『]?([^”"」』\n；;]{1,180})/i)?.[1];
  if(nav){next.nav=nav.split(/[、,，|]/).map(s=>s.trim()).filter(Boolean).slice(0,5).map((label,i)=>({label,href:['#services','#about','#contact','#contact','#contact'][i]}));changes.push('navigation menu');}
  return {spec:normalizeSpec(next),changes};
}
const fieldLimits={brand:80,tagline:140,headline:220,description:800,ctaLabel:60,secondaryCta:60,email:283,style:16,accent:7,aboutTitle:220,aboutText:1000,locale:2,footer:300};
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function parseModelSpec(content,{secret=''}={}) {
  if(typeof content!=='string'||!content.trim()||content.length>40000)throw new Error('The model returned empty or invalid website content. Please try again.');
  if(secret&&content.includes(secret))throw new Error('The model returned invalid website content. Please try again.');
  let parsed;try{parsed=JSON.parse(content);}catch{throw new Error('The model did not return valid JSON. Please try again.');}
  if(secret&&JSON.stringify(parsed).includes(secret))throw new Error('The model returned invalid website content. Please try again.');
  const keys=[...Object.keys(fieldLimits),'services','nav','pageType'];
  if(Object.hasOwn(parsed||{},'pageType')&&!['business','toy-store'].includes(parsed.pageType))throw new Error('The model returned an invalid page type. Please try again.');
  if(!isObject(parsed)||Object.keys(parsed).some(key=>!keys.includes(key))||Object.entries(fieldLimits).some(([key,max])=>!validText(parsed[key],max))||!styles.includes(parsed.style)||!/^#[0-9a-fA-F]{6}$/.test(parsed.accent)||parsed.locale!=='en'||!/^[^\s@<>"']{1,100}@[^\s@<>"']{1,150}\.[^\s@<>"']{2,30}$/.test(parsed.email))throw new Error('The model returned an invalid website structure. Please try again.');
  if(!Array.isArray(parsed.services)||parsed.services.length<1||parsed.services.length>6||parsed.services.some(service=>!isObject(service)||Object.keys(service).some(key=>!['title','description'].includes(key))||!validText(service.title,100)||!validText(service.description,500)))throw new Error('The model returned invalid service content. Please try again.');
  if(!Array.isArray(parsed.nav)||parsed.nav.length<1||parsed.nav.length>5||parsed.nav.some(item=>!isObject(item)||Object.keys(item).some(key=>!['label','href'].includes(key))||!validText(item.label,50)||!/^#(?:top|services|about|contact)$/.test(item.href)))throw new Error('The model returned invalid navigation content. Please try again.');
  return normalizeSpec(parsed);
}
function contentMessages(previous,message,style) {
  return [
    {role:'system',content:`You are a website art director. Return ONLY one JSON object representing English website content, with the exact fields and types shown in the JSON example below. Never return executable code, markdown, extra fields or secrets. Preserve and refine the supplied schema. All standard fields are required; pageType is business or toy-store (choose toy-store for a building-toy storefront introduction; use business otherwise). This optional layout field changes original illustrations and storefront section text; it does not enable checkout. style is one of ${styles.join(", ")}, accent is #RRGGBB, locale is en. Available design directions: ${JSON.stringify(STYLE_CATALOG.map(({id,description,tags})=>({id,description,tags})))}. Respect an explicit requestedStyle; do not substitute another layout. Provide 1 to 6 services and 1 to 5 navigation entries. Navigation hrefs must be #top, #services, #about or #contact. Keep copy in English, preserve explicit brand names, and honor the business requirements. Keep claims factual; do not invent customer counts, logos, testimonials or certifications. Content is rendered in trusted local templates; no arbitrary generated code will run. Maximum character lengths: ${JSON.stringify(fieldLimits)}; service title 100, service description 500, navigation label 50. JSON example: ${JSON.stringify(DEFAULT_SPEC)}`},
    {role:'user',content:JSON.stringify({currentWebsite:previous,request:message,requestedStyle:style||previous.style})},
  ];
}
async function generateWithOllama(previous,message,style,model) {
  const rawUrl=process.env.BIZNOVA_OLLAMA_URL||'http://127.0.0.1:11434';
  let base;
  try {base=new URL(rawUrl);}catch {throw new Error('The Ollama URL is invalid. Configure a local HTTP address.');}
  if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password)throw new Error('Ollama must use a local loopback HTTP address.');
  const response=await fetch(`${base.origin}/api/chat`,{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),
    body:JSON.stringify({model,stream:false,format:'json',messages:contentMessages(previous,message,style)}),
  });
  if(!response.ok)throw new Error(`Ollama returned ${response.status}. Check the local service and model name.`);
  const body=await response.json();
  if(body.done_reason==='length')throw new Error('The local model response was truncated. Please try again.');
  return parseModelSpec(body.message?.content,{secret:(process.env.DEEPSEEK_API_KEY||'').trim()});
}
async function requestDeepSeekResponse(payload,{signal}={}) {
  const key=(process.env.DEEPSEEK_API_KEY||'').trim();
  if(key&&JSON.stringify(payload.messages).includes(key))throw configurationError('Credentials must not be included in website requests.');
  let response;
  try {
    response=await fetch(deepseekEndpoint,{
      method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(90000),
      body:JSON.stringify(payload),
    });
  } catch(error) {
    throw configurationError(error?.name==='TimeoutError'||error?.name==='AbortError'?'DeepSeek timed out. Your saved version is unchanged; try again.':'Unable to reach the official DeepSeek API. Check your connection and try again.');
  }
  if(!response.ok){
    const messages={400:'DeepSeek rejected the model or request. Check BIZNOVA_DEEPSEEK_MODEL and try again.',401:'DeepSeek authentication failed. Check DEEPSEEK_API_KEY on the local server.',402:'The DeepSeek account has insufficient balance. Add API credit before trying again.',403:'DeepSeek denied access. Check the API key permissions.',404:'The selected DeepSeek model is unavailable. Check BIZNOVA_DEEPSEEK_MODEL.',429:'DeepSeek is rate limited. Wait a moment before trying again.'};
    throw configurationError(messages[response.status]||(response.status>=500?'DeepSeek is temporarily unavailable. Your saved version is unchanged; try again later.':'DeepSeek could not complete this request. Check the API configuration and try again.'));
  }
  let body;
  try {body=await response.json();}catch{throw configurationError('DeepSeek returned an invalid response. Please try again.');}
  if(!Array.isArray(body?.choices)||body.choices.length!==1||!['stop','tool_calls'].includes(body.choices[0]?.finish_reason))throw configurationError('DeepSeek returned an incomplete response. Your saved version is unchanged; try again.');
  if(key&&JSON.stringify(body.choices[0]).includes(key))throw configurationError('The model returned invalid website content. Please try again.');
  return body.choices[0];
}
async function generateWithDeepSeek(previous,message,style,model) {
  const choice=await requestDeepSeekResponse({model,stream:false,max_tokens:4096,thinking:{type:'disabled'},response_format:{type:'json_object'},messages:contentMessages(previous,message,style)});
  if(choice.finish_reason!=='stop')throw configurationError('DeepSeek returned an incomplete response. Your saved version is unchanged; try again.');
  try {return parseModelSpec(choice.message?.content,{secret:(process.env.DEEPSEEK_API_KEY||'').trim()});}catch(error){throw configurationError(error.message);}
}
async function completeDeepSeekTools(messages,tools,{signal},model) {
  const choice=await requestDeepSeekResponse({model,stream:false,max_tokens:5000,thinking:{type:'disabled'},tool_choice:'auto',tools,messages},{signal});
  const message=choice.message;
  if(!message||message.role!=='assistant')throw configurationError('DeepSeek returned an invalid tool response. Your saved website is unchanged.');
  return {role:'assistant',content:message.content??null,...(message.tool_calls?{tool_calls:message.tool_calls}:{})};
}
export async function generateSpec({prompt,style,name,current,scope='auto',history=[],autonomous=true}) {
  const config=modelConfig(),settings=modelSettings();
  if(settings.error)throw configurationError(settings.error);
  if(scope!=='auto'&&config.mode!=='deepseek')throw configurationError('Locked edit scopes require DeepSeek tool calling. Select Auto scope or configure DeepSeek.');
  if(config.mode==='deepseek'&&(current||autonomous)){
    const seed=current||normalizeSpec({...createInitialSpec(prompt,style),...(name?{brand:name}:{}),nav:[{label:'Home',href:'/'}],pages:[{id:'home',slug:'/',title:'Home',sections:[]}]});
    const result=await runWebsiteAgent({current:seed,request:prompt,style,scope,autonomous,initial:!current,history,complete:(messages,tools,options)=>completeDeepSeekTools(messages,tools,options,config.model)});
    return {...result,engine:'deepseek',summary:`DeepSeek tool calling: ${result.summary}`,agentRun:{...result.agentRun,model:config.model}};
  }

  if(config.mode==='deepseek'||config.mode==='ollama'){
    let spec;
    try {spec=await (config.mode==='deepseek'?generateWithDeepSeek:generateWithOllama)(current||createInitialSpec(prompt,style),prompt,style,config.model);}
    catch(error){if(config.mode==='deepseek')throw error;throw configurationError(error.name==='TimeoutError'?'The local model timed out. Make sure Ollama is running.':error.message);}
    if(name&&!current)spec=normalizeSpec({...spec,brand:name});
    return {spec,engine:config.mode,summary:config.mode==='deepseek'?`${current?'Updated':'Created'} website content with the DeepSeek API (${config.model}) and prepared the preview and full-stack project. You can continue refining the copy, style or colors.`:modelSummary(config.model,current)};
  }
  if(current){const {spec,changes}=localEdit(current,prompt,style);return {spec,engine:'local',summary:changes.length?updatedSummary(changes):supportedEdits};}
  let spec=createInitialSpec(prompt,style);if(name)spec=normalizeSpec({...spec,brand:name});
  const edited=localEdit(spec,prompt,style);spec=edited.spec;
  return {spec,engine:'local',summary:initialSummary};
}
