import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createProject, getProject, initStudio, listAgentRuns, reviseProject } from '../local/studio-repository.mjs';
import { handleStudioRequest } from '../local/studio-routes.mjs';
import { DEFAULT_SPEC, normalizeSpec } from '../local/site-generator.mjs';

const initialSpec=()=>normalizeSpec({...DEFAULT_SPEC,brand:'Trace Test'});
const create=db=>createProject(db,{name:'Trace Test',prompt:'Create a consulting website.',spec:initialSpec(),summary:'Created a website.'});
const run=(id,changedFields=['headline'])=>({
  id,status:'completed',startedAt:'2026-11-04T10:00:00.000Z',completedAt:'2026-11-04T10:00:01.000Z',
  steps:[{id:`${id}-step`,tool:'update_copy',arguments:{headline:'A measurable improvement'},ok:true,
    summary:'Updated the headline.',durationMs:4,changedFields}],
  changedFields,modelTurns:2,model:'unit-test-model'
});

test('Agent trace schema upgrades an existing Studio database and preserves old records',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE studio_projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,spec_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE studio_messages (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE studio_versions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),label TEXT NOT NULL,spec_json TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE studio_leads (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),name TEXT NOT NULL,email TEXT NOT NULL,company TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
      PRAGMA foreign_keys = ON;
    `);
    const spec=initialSpec(),now='2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO studio_projects VALUES (?, ?, ?, ?, ?, ?)').run('legacy-project','Legacy',JSON.stringify(spec),1,now,now);
    db.prepare('INSERT INTO studio_versions VALUES (?, ?, ?, ?, ?, ?)').run('legacy-version','legacy-project','Initial website',JSON.stringify(spec),1,now);
    db.prepare('INSERT INTO studio_messages VALUES (?, ?, ?, ?, ?)').run('legacy-message','legacy-project','user','An existing conversation.',now);
    initStudio(db);initStudio(db);
    const legacy=getProject(db,'legacy-project');
    assert.equal(legacy.messages[0].content,'An existing conversation.');
    assert.equal(legacy.versions[0].id,'legacy-version');
    assert.deepEqual(legacy.agentRuns,[]);
    const next=reviseProject(db,legacy,{message:'Update the headline.',spec:{...spec,headline:'A measurable improvement'},summary:'Updated.',agentRun:run('upgraded-run')});
    assert.equal(next.revision,2);
    assert.equal(next.agentRuns[0].versionId,next.versions[0].id);
    assert.equal(next.agentRuns[0].revision,2);
    assert.deepEqual(next.agentRuns[0].steps,run('upgraded-run').steps);
    assert.equal(next.versions[1].id,'legacy-version');
  } finally {db.close();}
});

test('Agent traces are committed with versions and returned newest first with only public metadata',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const original=create(db),trace={...run('first-run'),scope:'hero'};
    trace.providerConfig={private:'provider-configuration'};
    trace.rawResponse={private:'provider-response'};
    trace.steps[0].rawResponse='private-model-response';
    const changed=reviseProject(db,original,{message:'Update the headline.',spec:{...original.spec,headline:'A measurable improvement'},summary:'Updated.',agentRun:trace});
    const latest=reviseProject(db,changed,{message:'Update the footer.',spec:{...changed.spec,footer:'Made for growth.'},summary:'Updated.',agentRun:{...run('second-run',['footer']),scope:'footer'}});
    const runs=listAgentRuns(db,original.id);
    assert.deepEqual(runs.map(item=>item.id),['second-run','first-run']);
    assert.equal(runs[0].versionId,latest.versions[0].id);
    assert.equal(runs[1].versionId,changed.versions[0].id);
    assert.equal(runs[1].model,'unit-test-model');
    assert.equal(runs[1].modelTurns,2);
    assert.equal(runs[0].scope,'footer');
    assert.equal(runs[1].scope,'hero');
    assert.deepEqual(runs[1].changedFields,['headline']);
    assert.deepEqual(runs[1].steps[0].arguments,{headline:'A measurable improvement'});
    assert.ok(!JSON.stringify(runs).includes('private'));
    assert.deepEqual(latest.agentRuns,runs);
    assert.deepEqual(listAgentRuns(db,'another-project'),[]);
  } finally {db.close();}
});

test('Existing agent runs migrate to Auto scope and only documented scopes are persisted',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE studio_agent_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_id TEXT NOT NULL,
      revision INTEGER NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL, steps_json TEXT NOT NULL, changed_fields_json TEXT NOT NULL,
      model_turns INTEGER NOT NULL, model TEXT, created_at TEXT NOT NULL
    )`);
    const legacy=run('legacy-run'),now=legacy.completedAt;
    db.prepare('INSERT INTO studio_agent_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      legacy.id,'legacy-project','legacy-version',1,legacy.status,legacy.startedAt,legacy.completedAt,
      JSON.stringify(legacy.steps),JSON.stringify(legacy.changedFields),legacy.modelTurns,legacy.model,now
    );
    initStudio(db);initStudio(db);
    const restored=listAgentRuns(db,'legacy-project');
    assert.equal(restored[0].scope,'auto');
    assert.deepEqual(restored[0].steps,legacy.steps);
    assert.equal(db.prepare('PRAGMA table_info(studio_agent_runs)').all().filter(column=>column.name==='scope').length,1);
    const original=create(db);
    const invalidScope=reviseProject(db,original,{message:'Inspect the site.',spec:original.spec,summary:'Unchanged.',agentRun:{...run('invalid-scope',[]),scope:'raw-private-scope'}});
    assert.equal(invalidScope.agentRuns[0].scope,'auto');
    assert.equal(db.prepare('SELECT scope FROM studio_agent_runs WHERE id = ?').get('invalid-scope').scope,'auto');
    assert.ok(!JSON.stringify(invalidScope.agentRuns).includes('raw-private-scope'));
  } finally {db.close();}
});

test('Agent trace insertion failures roll back project creation, messages and versions',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const original=create(db);
    const changed=reviseProject(db,original,{message:'Update the headline.',spec:{...original.spec,headline:'First revision'},summary:'Updated.',agentRun:run('duplicate-run')});
    assert.throws(()=>reviseProject(db,changed,{message:'Another revision.',spec:{...changed.spec,headline:'Must roll back'},summary:'Updated.',agentRun:run('duplicate-run')}),/UNIQUE constraint failed/);
    assert.deepEqual(getProject(db,original.id),changed);
    assert.throws(()=>createProject(db,{name:'Must roll back',prompt:'Create another website.',spec:initialSpec(),summary:'Created.',agentRun:run('duplicate-run')}),/UNIQUE constraint failed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM studio_projects').get().total,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM studio_versions').get().total,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM studio_messages').get().total,4);
    assert.equal(listAgentRuns(db,original.id).length,1);
  } finally {db.close();}
});

test('Agent revisions retain compare-and-swap protection and do not create versions for no-op runs',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const original=create(db);
    const changed=reviseProject(db,original,{message:'Update the headline.',spec:{...original.spec,headline:'First revision'},summary:'Updated.',agentRun:run('valid-run')});
    assert.throws(()=>reviseProject(db,original,{message:'A stale revision.',spec:{...original.spec,headline:'Stale revision'},summary:'Updated.',agentRun:run('stale-run')}),error=>error.status===409);
    assert.deepEqual(getProject(db,original.id),changed);
    const unchanged=reviseProject(db,changed,{message:'Inspect the website.',spec:structuredClone(changed.spec),summary:'No website changes were needed.',agentRun:run('no-op-run',[])});
    assert.equal(unchanged.revision,changed.revision);
    assert.deepEqual(unchanged.versions,changed.versions);
    assert.equal(unchanged.messages.length,changed.messages.length+2);
    assert.equal(unchanged.agentRuns[0].id,'no-op-run');
    assert.equal(unchanged.agentRuns[0].versionId,changed.versions[0].id);
    assert.equal(unchanged.agentRuns[0].revision,changed.revision);
  } finally {db.close();}
});

test('Studio exposes persisted agent runs without adding traces to generated files or exports',async()=>{
  const db=new DatabaseSync(':memory:'),original=create(db),trace=run('trace-only-sentinel');
  trace.steps[0].summary='trace-result-only-sentinel';
  const project=reviseProject(db,original,{message:'Update the headline.',spec:{...original.spec,headline:'A measurable improvement'},summary:'Updated.',agentRun:trace});
  const server=createServer(async(request,response)=>{if(!await handleStudioRequest(request,response,{db})){response.writeHead(404);response.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,path=`/api/studio/projects/${project.id}`;
  try {
    const response=await fetch(`${base}${path}/runs`);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{runs:project.agentRuns});
    const details=await(await fetch(`${base}${path}`)).json();
    assert.deepEqual(details.agentRuns,project.agentRuns);
    const head=await fetch(`${base}${path}/runs`,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(`${base}/api/studio/projects/missing/runs`)).status,404);
    assert.equal((await fetch(`${base}${path}/runs`,{method:'POST'})).status,405);
    const files=await(await fetch(`${base}${path}/files`)).text();
    const archive=Buffer.from(await(await fetch(`${base}${path}/export`)).arrayBuffer());
    for(const sentinel of ['trace-only-sentinel','trace-result-only-sentinel','Update the headline.','unit-test-model']){
      assert.ok(!files.includes(sentinel));assert.ok(!archive.includes(sentinel));
    }
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
