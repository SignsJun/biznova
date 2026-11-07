import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSpec as generateProviderSpec, modelConfig } from '../local/studio-model.mjs';
import { DEFAULT_SPEC, normalizeSpec } from '../local/site-generator.mjs';

const generateSpec=args=>generateProviderSpec({...args,autonomous:!!args.current});
const fakeKey='sk-unit-test-not-a-real-key';
const envKeys=['DEEPSEEK_API_KEY','BIZNOVA_MODEL_PROVIDER','BIZNOVA_DEEPSEEK_MODEL','BIZNOVA_OLLAMA_MODEL','BIZNOVA_OLLAMA_URL','BIZNOVA_DEEPSEEK_URL'];
const brief={prompt:'Build an English website for a design practice.',style:'editorial'};
const validSpec=()=>({...structuredClone(DEFAULT_SPEC),brand:'Future Practice',headline:'Build something worth sharing.',style:'editorial',accent:'#dd7733'});
const completion=(content,finish='stop')=>({choices:[{finish_reason:finish,message:{role:'assistant',content:typeof content==='string'?content:JSON.stringify(content)}}]});
const jsonResponse=body=>({ok:true,status:200,json:async()=>body});

async function withEnvironment(values,fetcher,run) {
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]])),previousFetch=globalThis.fetch;
  for(const key of envKeys)delete process.env[key];
  Object.assign(process.env,values);
  globalThis.fetch=fetcher||(async()=>{assert.fail('Unexpected network request');});
  try{return await run();}finally{
    globalThis.fetch=previousFetch;
    for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
}

test('DeepSeek selection exposes only safe configuration and honors explicit providers',async()=>{
  await withEnvironment({DEEPSEEK_API_KEY:fakeKey,BIZNOVA_OLLAMA_MODEL:'llama3'},null,async()=>{
    const config=modelConfig();
    assert.equal(config.mode,'deepseek');assert.equal(config.label,'DeepSeek API');assert.equal(config.model,'deepseek-flash');assert.equal(config.configured,true);
    assert.ok(!JSON.stringify(config).includes(fakeKey));assert.ok(!Object.hasOwn(config,'key'));assert.ok(!Object.hasOwn(config,'apiKey'));
    process.env.BIZNOVA_MODEL_PROVIDER='local';assert.equal(modelConfig().mode,'local');assert.equal((await generateSpec(brief)).engine,'local');
    process.env.BIZNOVA_MODEL_PROVIDER='ollama';assert.equal(modelConfig().mode,'ollama');
    delete process.env.BIZNOVA_MODEL_PROVIDER;delete process.env.DEEPSEEK_API_KEY;assert.equal(modelConfig().mode,'ollama');
    delete process.env.BIZNOVA_OLLAMA_MODEL;assert.equal(modelConfig().mode,'local');
  });
});

test('DeepSeek sends one authenticated JSON call only to the official HTTPS endpoint',async()=>{
  const calls=[];
  await withEnvironment({DEEPSEEK_API_KEY:fakeKey,BIZNOVA_DEEPSEEK_URL:'https://attacker.example/collect'},async(url,options)=>{
    calls.push({url,options});return jsonResponse(completion(validSpec()));
  },async()=>{
    const result=await generateSpec({...brief,name:'Confirmed Brand'});
    assert.equal(result.engine,'deepseek');assert.equal(result.spec.brand,'Confirmed Brand');assert.equal(result.spec.headline,'Build something worth sharing.');assert.equal(result.spec.locale,'en');
    assert.deepEqual(result.spec,normalizeSpec(result.spec));assert.match(result.summary,/Created website content with the DeepSeek API/);assert.ok(!/[\p{Script=Han}]/u.test(result.summary));assert.ok(!JSON.stringify(result).includes(fakeKey));
    assert.equal(calls.length,1);const {url,options}=calls[0];
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${fakeKey}`);assert.equal(options.headers['Content-Type'],'application/json');assert.ok(options.signal instanceof AbortSignal);
    const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.stream,false);assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.max_tokens,4096);
    assert.match(body.messages[0].content,/JSON example/);for(const field of Object.keys(DEFAULT_SPEC))assert.ok(body.messages[0].content.includes(`"${field}"`));
    assert.equal(JSON.parse(body.messages[1].content).request,brief.prompt);assert.ok(!options.body.includes(fakeKey));
  });
});

test('DeepSeek revisions use autonomous tools and preserve untouched website fields',async()=>{
  const current=validSpec(),original=structuredClone(current);let turn=0;
  const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  await withEnvironment({DEEPSEEK_API_KEY:fakeKey,BIZNOVA_DEEPSEEK_MODEL:'deepseek-v4-pro'},async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(body.model,'deepseek-v4-pro');assert.ok(body.tools.some(t=>t.function.name==='update_section'));assert.equal(body.tool_choice,'auto');assert.equal(body.response_format,undefined);assert.deepEqual(body.thinking,{type:'disabled'});assert.ok(!options.body.includes(fakeKey));
    const user=JSON.parse(body.messages.find(m=>m.role==='user').content);assert.equal(user.editScope,'hero');
    if(turn++===0)return jsonResponse({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[call('read1','read_site',{section:'hero'})]}}]});
    if(turn===2){const observation=body.messages.find(m=>m.role==='tool');assert.equal(observation.tool_call_id,'read1');assert.equal(JSON.parse(observation.content).website.headline,current.headline);return jsonResponse({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[call('edit1','update_section',{section:'hero',changes:{headline:'A refined direction.'}}),call('validate1','validate_site',{})]}}]});}
    assert.equal(body.messages.filter(m=>m.role==='tool').length,3);
    return jsonResponse(completion('The requested headline is updated and validated.'));
  },async()=>{
    const result=await generateSpec({prompt:'Refine only the headline.',current,scope:'hero'});assert.equal(result.spec.headline,'A refined direction.');assert.match(result.summary,/DeepSeek tool calling/);assert.deepEqual(current,original);assert.deepEqual({...result.spec,headline:current.headline},current);assert.deepEqual(result.agentRun.changedFields,['headline']);assert.equal(result.agentRun.modelTurns,3);assert.equal(result.agentRun.steps.length,3);assert.ok(!JSON.stringify(result).includes(fakeKey));
  });
});

test('Missing credentials and invalid configuration reject before any network request',async()=>{
  const cases=[
    [{BIZNOVA_MODEL_PROVIDER:'deepseek'},/DEEPSEEK_API_KEY is not configured/],
    [{DEEPSEEK_API_KEY:fakeKey,BIZNOVA_DEEPSEEK_MODEL:'https://attacker.example/model'},/valid DeepSeek model/],
    [{DEEPSEEK_API_KEY:fakeKey,BIZNOVA_DEEPSEEK_MODEL:fakeKey},/valid DeepSeek model/],
    [{DEEPSEEK_API_KEY:fakeKey,BIZNOVA_MODEL_PROVIDER:'unexpected'},/must be local, ollama or deepseek/],
  ];
  for(const [env,message] of cases)await withEnvironment(env,null,async()=>{
    const config=modelConfig();assert.equal(config.configured,false);assert.ok(!JSON.stringify(config).includes(fakeKey));
    await assert.rejects(generateSpec(brief),error=>error.status===502&&message.test(error.message)&&!error.message.includes(fakeKey));
  });
});

test('DeepSeek provider errors are translated without exposing response bodies or repeating requests',async()=>{
  const statuses=[[400,/rejected the model/],[401,/authentication failed/],[402,/insufficient balance/],[403,/denied access/],[404,/model is unavailable/],[429,/rate limited/],[500,/temporarily unavailable/],[503,/temporarily unavailable/]];
  for(const [status,message] of statuses){
    let calls=0,bodyRead=false;
    await withEnvironment({DEEPSEEK_API_KEY:fakeKey},async()=>{calls++;return {ok:false,status,json:async()=>{bodyRead=true;return {error:fakeKey};}};},async()=>{
      await assert.rejects(generateSpec(brief),error=>error.status===502&&message.test(error.message)&&!error.message.includes(fakeKey));assert.equal(calls,1);assert.equal(bodyRead,false);
    });
  }
});

test('DeepSeek connection failures, timeouts and invalid envelopes never leak raw errors',async()=>{
  const failures=[
    [async()=>{throw new Error(`Raw network error ${fakeKey}`);},/Unable to reach/],
    [async()=>{throw Object.assign(new Error(fakeKey),{name:'TimeoutError'});},/timed out/],
    [async()=>({ok:true,json:async()=>{throw new Error(fakeKey);}}),/invalid response/],
    [async()=>jsonResponse(null),/incomplete response/],
    [async()=>jsonResponse({choices:[]}),/incomplete response/],
    [async()=>jsonResponse(completion(validSpec(),'length')),/incomplete response/],
    [async()=>jsonResponse(completion(validSpec(),'content_filter')),/incomplete response/],
  ];
  for(const [fetcher,message] of failures)await withEnvironment({DEEPSEEK_API_KEY:fakeKey},fetcher,async()=>{
    await assert.rejects(generateSpec(brief),error=>error.status===502&&message.test(error.message)&&!error.message.includes(fakeKey));
  });
});

test('DeepSeek rejects empty, malformed, unsupported, overlong and unsafe structured content',async()=>{
  const invalid=[
    '',null,' ', '```json\n{}\n```','{',JSON.stringify([]),'x'.repeat(40001),{},
    {...validSpec(),code:'alert(1)'},{...validSpec(),headline:''},{...validSpec(),headline:'x'.repeat(221)},
    {...validSpec(),pageType:'arbitrary-code'},{...validSpec(),pageType:null},{...validSpec(),style:'unknown'},{...validSpec(),accent:'red'},{...validSpec(),locale:'zh'},
    {...validSpec(),email:'not-an-email'},{...validSpec(),services:[]},
    {...validSpec(),services:[{title:'Good',description:'Copy',script:'bad'}]},
    {...validSpec(),nav:[{label:'External',href:'https://example.com'}]},
    {...validSpec(),nav:[{label:'Bad',href:'#missing'}]},
    {...validSpec(),description:fakeKey},
    JSON.stringify({...validSpec(),description:fakeKey}).replace('sk-unit','\\u0073k-unit'),
  ];
  for(const content of invalid)await withEnvironment({DEEPSEEK_API_KEY:fakeKey},async()=>jsonResponse(completion(content)),async()=>{
    await assert.rejects(generateSpec(brief),error=>error.status===502&&!error.message.includes(fakeKey));
  });
});


test('DeepSeek structured builds accept an explicit supported storefront layout',async()=>{
  await withEnvironment({DEEPSEEK_API_KEY:fakeKey},async()=>jsonResponse(completion({...validSpec(),pageType:'toy-store'})),async()=>{
    const result=await generateSpec(brief);
    assert.equal(result.spec.pageType,'toy-store');
    assert.equal(result.spec.brand,validSpec().brand);
  });
});
