import { STYLE_IDS, STYLE_CATALOG } from '../lib/studio-styles.ts';
import { createProject, getProject, initStudio, listProjects, reviseProject, saveLead, listLeads, listAgentRuns } from './studio-repository.mjs';
import { generateSpec, modelConfig, englishStudioMessage } from './studio-model.mjs';
import { normalizeSpec, renderSite, createProjectFiles, DEFAULT_SPEC } from './site-generator.mjs';

class RequestError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new RequestError(status,message);};
const projectForClient=project=>({...project,spec:normalizeSpec(project.spec),versions:project.versions.map(version=>({...version,spec:normalizeSpec(version.spec)})),messages:project.messages.map(englishStudioMessage)});
const text=(value,name,max,{required=true,min=1}={})=>{
  if(value===undefined&&!required)return '';
  if(typeof value!=='string')fail(400,`${name} must be text.`);
  const result=value.trim();if(result.length>max||(required&&result.length<min))fail(400,`${name} must contain ${min}–${max} characters.`);
  return result;
};
const validateStyle=value=>{if(value===undefined)return undefined;if(!STYLE_IDS.includes(value))fail(400,'Unknown design style.');return value;};
const allowed=(body,keys)=>{for(const key of Object.keys(body))if(!keys.includes(key))fail(400,`Unsupported field: ${key}`);};
async function readBody(request) {
  if(!request.headers['content-type']?.toLowerCase().startsWith('application/json'))fail(415,'Use application/json.');
  if(Number(request.headers['content-length']||0)>65536){request.resume();fail(413,'Request body is too large.');}
  const chunks=await new Promise((resolve,reject)=>{
    const parts=[];let length=0,done=false;
    request.on('data',chunk=>{if(done)return;length+=chunk.length;if(length>65536){done=true;reject(new RequestError(413,'Request body is too large.'));return;}parts.push(chunk);});
    request.on('end',()=>{if(!done){done=true;resolve(parts);}});
    request.on('error',error=>{if(!done){done=true;reject(error);}});
    request.on('aborted',()=>{if(!done){done=true;reject(new RequestError(400,'Request was interrupted.'));}});
  });
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'Invalid JSON body.');}
  if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'Request body must be an object.');
  return value;
}
function checkOrigin(request) {
  const origin=request.headers.origin;
  if(!origin)return;
  let parsed;try{parsed=new URL(origin);}catch{fail(403,'Cross-origin requests are not allowed.');}
  if(parsed.origin!==`http://${request.headers.host}`||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))fail(403,'Cross-origin requests are not allowed.');
}
function crc32(buffer) {
  let crc=0xffffffff;
  for(const value of buffer){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function createZip(files) {
  const entries=[],directory=[];let offset=0;
  for(const file of files){
    const name=file.path;if(typeof name!=='string'||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')||!/^[a-zA-Z0-9_./-]+$/.test(name))throw new Error('Invalid export path.');
    const filename=Buffer.from(`website/${name}`),content=Buffer.from(file.content,'utf8'),crc=crc32(content);
    const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(content.length,18);head.writeUInt32LE(content.length,22);head.writeUInt16LE(filename.length,26);
    entries.push(head,filename,content);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(((name.endsWith('.command')?0o100755:0o100644)<<16)>>>0,38);central.writeUInt32LE(offset,42);
    directory.push(central,filename);offset+=head.length+filename.length+content.length;
  }
  const table=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,table,end]);
}
export async function handleStudioRequest(request,response,{db}) {
  let url;try{url=new URL(request.url,'http://localhost');}catch{return false;}
  if(url.pathname!=='/api/studio'&&!url.pathname.startsWith('/api/studio/'))return false;
  const send=(status,body,contentType='application/json; charset=utf-8')=>{
    response.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method==='HEAD'?undefined:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
  };
  try {
    if(!['GET','HEAD','POST'].includes(request.method)){response.setHeader('Allow','GET, HEAD, POST');fail(405,'Method not allowed.');}
    const read=request.method==='GET'||request.method==='HEAD';
    if(!read)checkOrigin(request);
    initStudio(db);
    if(url.pathname==='/api/studio/config'&&read){send(200,{...modelConfig(),schemaVersion:1});return true;}
    if(url.pathname==='/api/studio/style-preview'&&read){
      const style=validateStyle(url.searchParams.get('style')||'glass'),projectId=url.searchParams.get('project');
      let sample={...DEFAULT_SPEC,brand:'Northstar',accent:STYLE_CATALOG.find(s=>s.id===style).accent};
      if(projectId){if(!/^[a-zA-Z0-9-]{1,80}$/.test(projectId))fail(400,'Invalid project identifier.');const saved=getProject(db,projectId);if(!saved)fail(404,'Project not found.');sample=saved.spec;}
      send(200,renderSite(normalizeSpec({...sample,style}),{preview:true,projectId:projectId||''}),'text/html; charset=utf-8');return true;
    }
    if(url.pathname==='/api/studio/projects'){
      if(read){send(200,{projects:listProjects(db)});return true;}
      const body=await readBody(request);allowed(body,['prompt','name','style']);
      const prompt=text(body.prompt,'prompt',6000,{min:5}),name=text(body.name,'name',80,{required:false}),style=validateStyle(body.style)||'glass';
      const result=await generateSpec({prompt,name,style});
      send(201,{...projectForClient(createProject(db,{name,prompt,...result})),engine:result.engine});return true;
    }
    const match=url.pathname.match(/^\/api\/studio\/projects\/([a-zA-Z0-9-]{1,80})(?:\/(messages|restore|preview|export|files|leads|runs))?$/);
    if(!match)fail(404,'Studio route not found.');
    const [,id,action]=match,project=getProject(db,id);if(!project)fail(404,'Project not found.');
    if(!action&&read){send(200,projectForClient(project));return true;}
    if(action==='runs'&&read){send(200,{runs:listAgentRuns(db,id)});return true;}
    if(action==='preview'&&read){send(200,renderSite(project.spec,{preview:true,projectId:id}),'text/html; charset=utf-8');return true;}
    if(action==='files'&&read){send(200,{files:createProjectFiles(project.spec)});return true;}
    if(action==='export'&&read){
      const archive=createZip(createProjectFiles(project.spec));const slug=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'biznova-website';
      response.setHeader('Content-Disposition',`attachment; filename="${slug}-fullstack.zip"`);send(200,archive,'application/zip');return true;
    }
    if(action==='messages'&&!read){
      if(project.messages.length>=500)fail(409,'This conversation is full. Create a new project to continue.');
      const body=await readBody(request);allowed(body,['message','style','scope']);const message=text(body.message,'message',6000),style=validateStyle(body.style),scope=body.scope??'auto';
      if(!['auto','hero','services','about','footer','contact','brand','theme','navigation'].includes(scope))fail(400,'Unknown edit scope.');
      const result=await generateSpec({prompt:message,style,scope,current:project.spec});
      send(200,{...projectForClient(reviseProject(db,project,{message,...result})),engine:result.engine});return true;
    }
    if(action==='restore'&&!read){
      const body=await readBody(request);allowed(body,['versionId']);const versionId=text(body.versionId,'versionId',80),version=project.versions.find(v=>v.id===versionId);
      if(!version)fail(404,'Version not found.');
      send(200,projectForClient(reviseProject(db,project,{message:`Restore version ${version.revision}`,spec:normalizeSpec(version.spec),summary:`Restored version ${version.revision} and saved it as a new version. Your previous versions are still available.`,label:`Restored version ${version.revision}`})));return true;
    }
    if(action==='leads'){
      if(read){send(200,{leads:listLeads(db,id)});return true;}
      const body=await readBody(request);allowed(body,['name','email','message','company','website']);
      if(body.website!==undefined&&text(body.website,'website',200,{required:false}))fail(400,'Message could not be submitted.');
      const payload={name:text(body.name,'name',100),email:text(body.email,'email',200),company:text(body.company,'company',150,{required:false}),message:text(body.message,'message',5000,{min:3})};
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))fail(400,'Please enter a valid email address.');
      const lead=saveLead(db,id,payload);send(201,{ok:true,id:lead.id,createdAt:lead.createdAt});return true;
    }
    response.setHeader('Allow',action==='messages'||action==='restore'?'POST':'GET, HEAD');fail(405,'Method not allowed.');
  } catch(error){
    const status=Number.isInteger(error.status)?error.status:500;
    if(status>=500)console.error('Studio request failed:',error.message);
    if(!response.headersSent)send(status,{error:status===500?'Unable to complete this action. Please try again.':error.message});
    else response.destroy();
  }
  return true;
}
