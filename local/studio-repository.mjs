import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const initialized = new WeakSet();
const EDIT_SCOPES = new Set(['auto','hero','services','about','footer','contact','brand','theme','navigation']);
const publicScope = scope => EDIT_SCOPES.has(scope) ? scope : 'auto';
export function initStudio(db) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, spec_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_messages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES studio_projects(id),
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_messages_project ON studio_messages(project_id, created_at);
    CREATE TABLE IF NOT EXISTS studio_versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES studio_projects(id),
      label TEXT NOT NULL, spec_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_leads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES studio_projects(id),
      name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_agent_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES studio_projects(id),
      version_id TEXT NOT NULL REFERENCES studio_versions(id), revision INTEGER NOT NULL,
      status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      steps_json TEXT NOT NULL, changed_fields_json TEXT NOT NULL, model_turns INTEGER NOT NULL,
      model TEXT, created_at TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'auto'
    );
    CREATE INDEX IF NOT EXISTS studio_agent_runs_project ON studio_agent_runs(project_id, created_at);
  `);
  // Upgrade databases created before edit scopes were included in run history.
  // SQLite supplies Auto for existing records without rewriting their traces.
  if (!db.prepare('PRAGMA table_info(studio_agent_runs)').all().some(column=>column.name==='scope')) {
    db.exec("ALTER TABLE studio_agent_runs ADD COLUMN scope TEXT NOT NULL DEFAULT 'auto'");
  }
  initialized.add(db);
}
const specOf = row => JSON.parse(row.spec_json);
export function listProjects(db) {
  initStudio(db);
  return db.prepare('SELECT id, name, spec_json, revision, created_at, updated_at FROM studio_projects ORDER BY updated_at DESC LIMIT 100').all().map(row => ({ id:row.id,name:row.name,style:specOf(row).style,brand:specOf(row).brand,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at }));
}
export function getProject(db,id) {
  initStudio(db);
  const row=db.prepare('SELECT * FROM studio_projects WHERE id = ?').get(id);
  if(!row) return null;
  const messages=db.prepare('SELECT id,role,content,created_at AS createdAt FROM studio_messages WHERE project_id = ? ORDER BY rowid ASC LIMIT 500').all(id);
  const versions=db.prepare('SELECT id,label,spec_json,revision,created_at AS createdAt FROM studio_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 100').all(id).map(v=>({id:v.id,label:v.label,spec:specOf(v),revision:v.revision,createdAt:v.createdAt}));
  return {id:row.id,name:row.name,spec:specOf(row),revision:row.revision,messages,versions,agentRuns:listAgentRuns(db,id),createdAt:row.created_at,updatedAt:row.updated_at};
}
export function listAgentRuns(db,projectId) {
  initStudio(db);
  return db.prepare(`SELECT id, version_id AS versionId, revision, status, started_at AS startedAt,
    completed_at AS completedAt, steps_json, changed_fields_json, model_turns AS modelTurns, model, scope
    FROM studio_agent_runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(projectId).map(row=>({
    id:row.id,versionId:row.versionId,revision:row.revision,status:row.status,
    startedAt:row.startedAt,completedAt:row.completedAt,steps:JSON.parse(row.steps_json),
    changedFields:JSON.parse(row.changed_fields_json),modelTurns:row.modelTurns,scope:publicScope(row.scope),...(row.model?{model:row.model}:{})
  }));
}
function writeMessage(db,projectId,role,content,now) {
  db.prepare('INSERT INTO studio_messages VALUES (?, ?, ?, ?, ?)').run(randomUUID(),projectId,role,content,now);
}
function writeVersion(db,projectId,label,spec,revision,now) {
  const id=randomUUID();
  db.prepare('INSERT INTO studio_versions VALUES (?, ?, ?, ?, ?, ?)').run(id,projectId,label,JSON.stringify(spec),revision,now);
  return id;
}
function writeAgentRun(db,projectId,versionId,revision,run,now) {
  if(!run)return;
  // Store only the tool protocol's public metadata, never provider configuration or raw responses.
  const steps=run.steps.map(step=>({
    id:step.id,tool:step.tool,arguments:step.arguments,ok:step.ok,summary:step.summary,
    durationMs:step.durationMs,changedFields:step.changedFields
  }));
  db.prepare(`INSERT INTO studio_agent_runs
    (id,project_id,version_id,revision,status,started_at,completed_at,steps_json,changed_fields_json,model_turns,model,created_at,scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    run.id,projectId,versionId,revision,run.status,run.startedAt,run.completedAt,
    JSON.stringify(steps),JSON.stringify(run.changedFields),run.modelTurns,run.model||null,now,publicScope(run.scope)
  );
}
export function createProject(db,{name,prompt,spec,summary,agentRun}) {
  initStudio(db);const id=randomUUID(),now=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO studio_projects (id,name,spec_json,revision,created_at,updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(id,name||spec.brand,JSON.stringify(spec),now,now);
    writeMessage(db,id,'user',prompt,now);writeMessage(db,id,'assistant',summary,now);
    const versionId=writeVersion(db,id,'Initial website',spec,1,now);
    writeAgentRun(db,id,versionId,1,agentRun,now);
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  return getProject(db,id);
}
export function reviseProject(db,project,{message,spec,summary,label='Website revision',agentRun}) {
  initStudio(db);
  const unchanged=Boolean(agentRun)&&isDeepStrictEqual(spec,project.spec);
  const now=new Date().toISOString(),revision=project.revision+(unchanged?0:1);
  db.exec('BEGIN IMMEDIATE');
  try {
    const update=db.prepare('UPDATE studio_projects SET spec_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(spec),revision,now,project.id,project.revision);
    if(!update.changes){const e=new Error('This project changed in another request. Reload and try again.');e.status=409;throw e;}
    writeMessage(db,project.id,'user',message,now);writeMessage(db,project.id,'assistant',summary,now);
    const versionId=unchanged
      ?db.prepare('SELECT id FROM studio_versions WHERE project_id = ? AND revision = ? ORDER BY rowid DESC LIMIT 1').get(project.id,revision).id
      :writeVersion(db,project.id,label,spec,revision,now);
    writeAgentRun(db,project.id,versionId,revision,agentRun,now);
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
  return getProject(db,project.id);
}
export function saveLead(db,id,payload) {
  const lead={id:randomUUID(),projectId:id,...payload,createdAt:new Date().toISOString()};
  db.prepare('INSERT INTO studio_leads VALUES (?, ?, ?, ?, ?, ?, ?)').run(lead.id,id,lead.name,lead.email,lead.company,lead.message,lead.createdAt);
  return lead;
}
export function listLeads(db,id) {
  return db.prepare('SELECT id,name,email,company,message,created_at AS createdAt FROM studio_leads WHERE project_id = ? ORDER BY rowid DESC LIMIT 100').all(id);
}
