import { DOCUMENT_TOOLS, SECTION_CATALOG, assertPages, executeDocumentTool, SiteDocumentError } from './site-document.mjs';
import { PLANNING_TOOLS, inspectAcceptance, validatePlan } from './site-planning.mjs';
import { STYLE_IDS, STYLE_CATALOG } from '../lib/studio-styles.ts';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSpec, renderSite } from './site-generator.mjs';

export const AUTONOMOUS_LIMITS=Object.freeze({turns:48,calls:128,timeout:600000});
const MAX_MODEL_TURNS = 6;
const MAX_TOOL_CALLS = 12;
const MAX_ARGUMENT_BYTES = 8 * 1024;
const MAX_RESULT_BYTES = 16 * 1024;
const RUN_TIMEOUT_MS = 120_000;
const STYLES = [...STYLE_IDS];
const FIELD_LIMITS = {
  brand: 80, tagline: 140, headline: 220, description: 800,
  ctaLabel: 60, secondaryCta: 60, email: 283, style: 16,
  accent: 7, locale: 2, aboutTitle: 220, aboutText: 1000, footer: 300, pageType: 16,
};
const SECTIONS = Object.freeze({
  hero: ['tagline', 'headline', 'description', 'ctaLabel', 'secondaryCta'],
  about: ['aboutTitle', 'aboutText'],
  footer: ['footer'],
  contact: ['email'],
  brand: ['brand'],
  services: ['services'],
  theme: ['style', 'accent', 'pageType'],
  navigation: ['nav'],
});
const EDITABLE_SECTIONS = ['hero', 'about', 'footer', 'contact', 'brand'];
const EDIT_SCOPES = ['auto', ...Object.keys(SECTIONS)];
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CREDENTIAL_PATTERN = /\bsk-[a-zA-Z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-zA-Z0-9_.~-]{16,}/i;

const textSchema = maxLength => ({ type: 'string', minLength: 1, maxLength });
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });
const navigationItem = objectSchema({ label: textSchema(50), href: { type: 'string', pattern: '^(?:#[a-z][a-z0-9_-]{0,63}|/(?:[a-z][a-z0-9-]{0,47})?(?:#[a-z][a-z0-9_-]{0,63})?)$' } }, ['label', 'href']);

// Standard Chat Completions function definitions. The executor additionally
// checks section-dependent keys and the actual current service index bounds.
export const WEBSITE_AGENT_TOOLS = Object.freeze([
  ...PLANNING_TOOLS, ...DOCUMENT_TOOLS,
  tool('list_styles', 'List the available original design directions and their layout differences. Use this to select a style that fits the request. This tool does not change content.', objectSchema({})),
  tool('read_site', 'Read the website with {} (do not use section all). section pages returns a lightweight outline; pageId and sectionId read exact content. Read the relevant content before changing it.', objectSchema({ section: { type: 'string', enum: [...Object.keys(SECTIONS), 'pages'] }, pageId:textSchema(48), sectionId:textSchema(48) })),
  tool('update_section', 'Update only the supplied fields in one section. Hero: tagline, headline, description, ctaLabel, secondaryCta. About: aboutTitle, aboutText. Footer: footer. Contact: email. Brand: brand. All other fields stay unchanged.', objectSchema({
    section: { type: 'string', enum: EDITABLE_SECTIONS },
    changes: { ...objectSchema(Object.fromEntries(EDITABLE_SECTIONS.flatMap(section => SECTIONS[section]).map(key => [key, textSchema(FIELD_LIMITS[key])]))), minProperties: 1 },
  }, ['section', 'changes'])),
  tool('update_service', 'Update a service at its existing zero-based index. Supply title, description, or both. Other services and other fields stay unchanged.', {
    ...objectSchema({ index: { type: 'integer', minimum: 0, maximum: 5 }, title: textSchema(100), description: textSchema(500) }, ['index']), minProperties: 2,
  }),
  tool('update_theme', 'Update visual style, accent color or pageType. pageType business is the general business introduction; toy-store is a building-toy storefront introduction with collection artwork, store copy and inquiry form. Set pageType only when the user requests this layout. Other fields stay unchanged.', {
    ...objectSchema({ style: { type: 'string', enum: STYLES }, accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, pageType: { type: 'string', enum: ['business', 'toy-store'] } }), minProperties: 1,
  }),
  tool('update_navigation', 'Replace navigation with 1–5 labeled internal section links. No other website fields change.', objectSchema({ items: { type: 'array', minItems: 1, maxItems: 5, items: navigationItem } }, ['items'])),
  tool('validate_site', 'Validate all current staged website content and safe visual tokens. This does not save changes.', objectSchema({})),
  tool('render_preview', 'Render the staged site with the real local HTML renderer. Returns HTML byte length and SHA-256 fingerprint; this is not a browser or visual inspection.', objectSchema({})),
]);

class ToolInputError extends Error {}
// Provider adapters may use this type only after translating raw failures into
// fixed, public guidance. Unmarked exceptions remain private to the server.
export class WebsiteAgentProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebsiteAgentProviderError';
    this.status = 502;
  }
}
const invalid = message => { throw new ToolInputError(message); };
const agentError = message => Object.assign(new Error(message), { status: 502 });
const failedMessage = 'The website agent could not complete this request. Your saved website is unchanged; try again.';
const timeoutMessage = 'The website agent timed out. Your saved website is unchanged; try again.';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function assertPlainJson(value, depth = 0) {
  if (depth > 12) invalid('Arguments must contain shallow plain JSON values.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !isObject(value)) invalid('Arguments must contain plain JSON values.');
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) invalid('Unsafe object keys are not allowed.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('Arguments must contain plain JSON values.');
    assertPlainJson(descriptor.value, depth + 1);
  }
}

function assertKeys(value, allowed, required = []) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('Provide only the documented fields required by this tool.');
}

function assertText(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`Text must contain 1–${max} characters and no control characters.`);
  if (CREDENTIAL_PATTERN.test(value)) invalid('Credentials and private keys are not allowed in website content.');
}

function assertField(key, value) {
  assertText(value, FIELD_LIMITS[key]);
  if (key === 'pageType' && !['business', 'toy-store'].includes(value)) invalid('Page type must be business or toy-store.');
  if (key === 'style' && !STYLES.includes(value)) invalid(`Style must be one of: ${STYLES.join(', ')}.`);
  if (key === 'accent' && !/^#[a-f\d]{6}$/i.test(value)) invalid('Accent must be a six-digit hexadecimal color.');
  if (key === 'locale' && value !== 'en') invalid('The website interface language must be en.');
  if (key === 'email' && !/^[^\s@<>"']{1,100}@[^\s@<>"']{1,150}\.[^\s@<>"']{2,30}$/.test(value)) invalid('Provide a valid contact email address.');
}

function assertNavigation(items, pages) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 5) invalid('Navigation must contain 1–5 items.');
  for (const item of items) {
    assertKeys(item, ['label', 'href'], ['label', 'href']);
    assertText(item.label, 50);
    if (pages ? !/^(?:#[a-z][a-z0-9_-]{0,63}|\/(?:[a-z][a-z0-9-]{0,47})?(?:#[a-z][a-z0-9_-]{0,63})?)$/.test(item.href) : !['#top','#services','#about','#contact'].includes(item.href)) invalid('Navigation links must use existing internal pages or section anchors.');
  }
}

function assertSpec(spec) {
  assertPlainJson(spec);
  const fields = [...Object.keys(FIELD_LIMITS), 'services', 'nav', 'pages'];
  assertKeys(spec, fields, fields.filter(key => !['pageType','pages'].includes(key)));
  for (const key of Object.keys(FIELD_LIMITS)) if (key !== 'pageType' || Object.hasOwn(spec, key)) assertField(key, spec[key]);
  if (!Array.isArray(spec.services) || spec.services.length < 1 || spec.services.length > 6) invalid('The website must have 1–6 services.');
  for (const service of spec.services) {
    assertKeys(service, ['title', 'description'], ['title', 'description']);
    assertText(service.title, 100);
    assertText(service.description, 500);
  }
  if (Object.hasOwn(spec,'pages')) { try {assertPages(spec.pages);} catch {invalid('The composed page structure is invalid.');} }
  assertNavigation(spec.nav,spec.pages);
}

function changedPaths(before, after) {
  const changed = [];
  for (const key of [...Object.keys(FIELD_LIMITS), 'services', 'nav', 'pages']) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    if (key === 'services' && before.services.length === after.services.length) {
      after.services.forEach((service, index) => {
        for (const field of ['title', 'description']) if (service[field] !== before.services[index][field]) changed.push(`services.${index}.${field}`);
      });
    } else changed.push(key);
  }
  return changed;
}

function fieldValue(spec, path) {
  return path.split('.').reduce((value, key) => value[key], spec);
}

function setField(spec, path, value) {
  const parts = path.split('.'), last = parts.pop();
  const target = parts.reduce((object, key) => object[key], spec);
  target[last] = structuredClone(value);
}

function normalizeScoped(candidate, before, allowedPaths) {
  // Reject invalid data before the permissive renderer normalizer can replace
  // it with defaults. Copy back only the explicit patch paths, so localization
  // and trimming can never rewrite unrelated stored website content.
  assertSpec(candidate);
  const normalized = normalizeSpec(candidate);
  for (const path of allowedPaths) setField(candidate, path, fieldValue(normalized, path));
  assertSpec(candidate);
  const changed = changedPaths(before, candidate);
  if (changed.some(path => !allowedPaths.includes(path))) throw agentError(failedMessage);
  return { spec: candidate, changedFields: changed };
}

function parseArguments(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_ARGUMENT_BYTES) invalid('Tool arguments must be a JSON object no larger than 8 KB.');
  let args;
  try { args = JSON.parse(raw); } catch { invalid('Tool arguments must be valid JSON.'); }
  assertPlainJson(args);
  if (!isObject(args)) invalid('Tool arguments must be a JSON object.');
  return args;
}

function assertToolScope(name, args, scope) {
  if (scope === 'auto') return;
  if (DOCUMENT_TOOLS.some(t=>t.function.name===name)) invalid('Page structure changes require Auto edit scope.');
  const target = name === 'update_section' ? args.section : {
    update_service: 'services', update_theme: 'theme', update_navigation: 'navigation',
  }[name];
  if (target !== undefined && target !== scope) invalid(`The edit scope is locked to ${scope}. Only changes within that scope are allowed.`);
}

function executeTool(name, args, staged, scope, context) {
  assertToolScope(name, args, scope);
  if (DOCUMENT_TOOLS.some(t=>t.function.name===name)) {
    try {return executeDocumentTool(name,args,staged);} catch(error){if(error instanceof SiteDocumentError)invalid(error.message);throw error;}
  }
  let candidate = structuredClone(staged), paths = [], summary, data;
  switch (name) {
    case 'plan_site': {
      if(CREDENTIAL_PATTERN.test(JSON.stringify(args)))invalid('Credentials are not allowed in a plan.');
      try{context.plan=validatePlan(args);}catch(error){invalid(error.message);}
      summary='Recorded the website goal, design direction and acceptance requirements.';data={plan:context.plan};break;
    }
    case 'list_sections': {assertKeys(args,[]);summary='Listed composable sections and layouts.';data={sections:SECTION_CATALOG};break;}
    case 'inspect_site': {assertKeys(args,[]);data=inspectAcceptance(staged,context.plan,{initial:context.initial});summary=data.valid?'All structural and plan checks passed.':'Found website checks that need repair.';break;}
    case 'finish_site': {
      assertKeys(args,['status','summary','remaining'],['status','summary','remaining']);
      if(!['completed','partial','unsupported'].includes(args.status)||!Array.isArray(args.remaining)||args.remaining.length>12)invalid('Provide a supported outcome and remaining work list.');
      assertText(args.summary,1200);for(const item of args.remaining)assertText(item,1200);
      const checks=inspectAcceptance(staged,context.plan,{initial:context.initial});
      if(args.status==='completed'&&(!checks.valid||args.remaining.length))invalid('Resolve the inspection errors and remaining work before reporting completed.');
      context.outcome=structuredClone(args);summary=`Recorded ${args.status} outcome.`;data={outcome:context.outcome,checks};break;
    }
    case 'list_styles': {
      assertKeys(args, []);
      data = { styles: structuredClone(STYLE_CATALOG) };
      summary = `Listed ${STYLE_CATALOG.length} design directions.`;
      break;
    }
    case 'read_site': {
      assertKeys(args, ['section','pageId','sectionId']);
      if (Object.hasOwn(args, 'section') && !(Object.hasOwn(SECTIONS, args.section)||args.section==='pages')) invalid('Select a documented website section.');
      data = { website: args.section==='pages'?{pages:(staged.pages||[]).map(p=>({id:p.id,slug:p.slug,title:p.title,sections:p.sections.map(s=>({id:s.id,type:s.type,layout:s.layout,title:s.title}))}))}:args.section ? Object.fromEntries(SECTIONS[args.section].map(key => [key, staged[key]])) : staged };
      if(staged.pages&&['hero','about','services'].includes(args.section)&&!args.pageId){
        const home=staged.pages.find(p=>p.id==='home'),section=home?.sections.find(s=>args.section==='hero'?s.type==='hero':args.section==='about'?s.id==='about':s.id==='services')||home?.sections.find(s=>args.section==='about'?s.type==='content':args.section==='services'?s.type==='features':false);
        data={website:section?structuredClone(section):null};
      }
      if(args.sectionId&&!args.pageId)invalid('Provide pageId when reading one section.');
      if(args.pageId){const page=staged.pages?.find(p=>p.id===args.pageId);if(!page)invalid('Page not found. Read section pages to inspect the page IDs.');data={website:args.sectionId?page.sections.find(s=>s.id===args.sectionId):page};if(!data.website)invalid('Section not found on the selected page.');}
      summary = args.section ? `Read the ${args.section} section.` : 'Read the staged website.';
      break;
    }
    case 'update_section': {
      assertKeys(args, ['section', 'changes'], ['section', 'changes']);
      if (!EDITABLE_SECTIONS.includes(args.section)) invalid('Select hero, about, footer, contact or brand.');
      assertKeys(args.changes, SECTIONS[args.section]);
      if (!Object.keys(args.changes).length) invalid('Provide at least one section field to update.');
      for (const [key, value] of Object.entries(args.changes)) { assertField(key, value); candidate[key] = value; paths.push(key); }
      if(staged.pages&&['hero','about'].includes(args.section)){
        const home=candidate.pages.find(p=>p.id==='home'),target=home?.sections.find(s=>args.section==='hero'?s.type==='hero':s.id==='about')||(args.section==='about'?home?.sections.find(s=>s.type==='content'):undefined);
        if(!target)invalid('This composed page has no matching component. Use Auto scope to add a section first.');
        const map=args.section==='hero'?{tagline:'eyebrow',headline:'title',description:'body',ctaLabel:'buttonLabel'}:{aboutTitle:'title',aboutText:'body'};
        for(const[key,value]of Object.entries(args.changes)){if(!map[key])invalid('This composed hero supports one primary CTA. Use Auto scope to restructure it.');target[map[key]]=value;}
        paths.push('pages');context.scopedPageEdit=true;
      }
      summary = `Updated the ${args.section} section.`;
      break;
    }
    case 'update_service': {
      assertKeys(args, ['index', 'title', 'description'], ['index']);
      if (!Number.isInteger(args.index) || args.index < 0 || args.index >= staged.services.length) invalid('Use the zero-based index of an existing service.');
      const fields = ['title', 'description'].filter(key => Object.hasOwn(args, key));
      if (!fields.length) invalid('Provide a service title, description or both.');
      for (const key of fields) { assertText(args[key], key === 'title' ? 100 : 500); candidate.services[args.index][key] = args[key]; paths.push(`services.${args.index}.${key}`); }
      if(staged.pages){const section=candidate.pages.find(p=>p.id==='home')?.sections.find(s=>s.id==='services'||s.type==='features');const item=section?.items?.[args.index];if(!item)invalid('That service is not present on the composed home page. Use read_site pages and update_page_section.');for(const field of fields)item[field==='description'?'body':field]=args[field];paths.push('pages');context.scopedPageEdit=true;}
      summary = `Updated service ${args.index + 1}.`;
      break;
    }
    case 'update_theme': {
      assertKeys(args, ['style', 'accent', 'pageType']);
      if (!Object.keys(args).length) invalid('Provide style, accent or pageType.');
      for (const [key, value] of Object.entries(args)) { assertField(key, value); candidate[key] = value; paths.push(key); }
      summary = 'Updated the website theme.';
      break;
    }
    case 'update_navigation': {
      assertKeys(args, ['items'], ['items']);
      assertNavigation(args.items,staged.pages);
      candidate.nav = structuredClone(args.items); paths = ['nav'];
      summary = 'Updated the navigation.';
      break;
    }
    case 'validate_site': {
      assertKeys(args, []); assertSpec(staged);
      data = { valid: true, ...(staged.pages?{checks:inspectAcceptance(staged,context.plan,{initial:context.initial})}:{}) }; summary = 'Validated the staged website.';
      break;
    }
    case 'render_preview': {
      assertKeys(args, []); assertSpec(staged);
      const html = renderSite(staged, { preview: true });
      data = { rendered: true, htmlBytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), browserInspection: false, ...(context.autonomous?{checks:inspectAcceptance(staged,context.plan,{initial:context.initial})}:{}) };
      summary = 'Rendered the staged HTML preview.';
      break;
    }
    default: invalid('Unknown tool. Use one of the documented website tools.');
  }
  const result = normalizeScoped(candidate, staged, paths);
  if (paths.length && !result.changedFields.length) summary = 'No website fields changed.';
  const observation = { ok: true, summary, changedFields: result.changedFields, ...data };
  if (Buffer.byteLength(JSON.stringify(observation)) > MAX_RESULT_BYTES) invalid('This result is too large. Read one website section at a time.');
  return { ...result, summary, observation };
}

function assistantMessage(value) {
  if (!isObject(value) || value.role !== 'assistant' || (value.content !== null && typeof value.content !== 'string') || (typeof value.content === 'string' && (value.content.length > 8000 || CREDENTIAL_PATTERN.test(value.content)))) throw agentError(failedMessage);
  if (value.tool_calls !== undefined && !Array.isArray(value.tool_calls)) throw agentError(failedMessage);
  const calls = value.tool_calls || [];
  if (calls.length > AUTONOMOUS_LIMITS.calls) throw agentError('The website agent reached its tool limit. Your saved website is unchanged; try a smaller request.');
  const ids = new Set();
  const toolCalls = calls.map(call => {
    if (!isObject(call) || typeof call.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(call.id) || ids.has(call.id) || call.type !== 'function' || !isObject(call.function) || typeof call.function.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(call.function.name)) throw agentError(failedMessage);
    ids.add(call.id);
    return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
  });
  return { role: 'assistant', content: value.content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

async function completeWithinBudget(complete, messages, signal) {
  if (signal.aborted) throw agentError(timeoutMessage);
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(agentError(timeoutMessage));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([Promise.resolve().then(() => complete(structuredClone(messages), structuredClone(WEBSITE_AGENT_TOOLS), { signal })), aborted]);
  } catch (error) {
    if (!signal.aborted && error instanceof WebsiteAgentProviderError) throw error;
    throw agentError(signal.aborted ? timeoutMessage : failedMessage);
  } finally { signal.removeEventListener('abort', onAbort); }
}

const FIELD_LABELS = { brand: 'brand name', tagline: 'hero tagline', headline: 'hero headline', description: 'business description', ctaLabel: 'primary call to action', secondaryCta: 'secondary call to action', email: 'contact email', style: 'visual style', accent: 'accent color', pageType: 'page layout', aboutTitle: 'about heading', aboutText: 'about copy', footer: 'footer copy', nav: 'navigation' };
function changeSummary(fields) {
  if (!fields.length) return 'No website fields changed. Your current website is unchanged.';
  const labels = fields.map(path =>path==='pages'?'page composition': path.startsWith('services.') ? `service ${Number(path.split('.')[1]) + 1} ${path.split('.')[2]}` : FIELD_LABELS[path] || path);
  return `Updated ${labels.join(', ')}. Validated the website content and prepared the local preview.`;
}

export async function runWebsiteAgent({ current, request, style, scope = 'auto', complete, autonomous=false, initial=false, history=[] }) {
  let staged;
  try {
    assertSpec(current);
    assertText(request, 6000);
    if (style !== undefined && !STYLES.includes(style)) invalid('Select a supported website style.');
    if (!EDIT_SCOPES.includes(scope)) invalid('Select a supported website edit scope.');
    if (typeof complete !== 'function') invalid('A model completion callback is required.');
    staged = structuredClone(current);
  } catch { throw agentError(failedMessage); }
  const limits=autonomous?AUTONOMOUS_LIMITS:{turns:MAX_MODEL_TURNS,calls:MAX_TOOL_CALLS,timeout:RUN_TIMEOUT_MS};
  const context={autonomous,initial,plan:null,outcome:null};let repairPrompted=false;
  const original = structuredClone(staged), startedAt = new Date().toISOString();
  const run = { id: randomUUID(), status: 'completed', scope, startedAt, completedAt: null, steps: [], changedFields: [], modelTurns: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeout);
  const touched = new Set();
  const deliver=(content)=>{
        assertSpec(staged);
        const fields = changedPaths(original, staged);
        if (fields.some(path => !touched.has(path))) throw agentError(failedMessage);
        if (scope !== 'auto' && fields.some(path => !(path==='pages'&&context.scopedPageEdit)&&!SECTIONS[scope].includes(path.split('.')[0]))) throw agentError(failedMessage);
        const checks=autonomous?inspectAcceptance(staged,context.plan,{initial}):null;
        if(autonomous&&initial&&!context.outcome)checks.issues.push({severity:'error',code:'outcome_required',message:'Call finish_site after checking the completed work.'});
        if(checks)checks.valid=!checks.issues.some(i=>i.severity==='error');
        run.changedFields = fields;
        if(autonomous){run.status=context.outcome?.status||((checks.valid&&(fields.length||context.outcome))?'completed':'partial');if(!checks.valid&&run.status==='completed')run.status='partial';run.checks=checks;if(context.plan)run.plan=context.plan;}
        run.completedAt = new Date().toISOString();
        const summary=autonomous?`${context.outcome?.summary||content.trim()}${fields.length?'\n\n'+changeSummary(fields):''}${context.outcome?.remaining.length?'\nRemaining: '+context.outcome.remaining.join('; '):''}`:changeSummary(fields);
        return { spec: structuredClone(staged), summary, changed: fields.length > 0, agentRun: run };
  };
  const messages = [
    { role: 'system', content: `You edit an English business website through the provided tools. Read relevant current content, choose the smallest scoped edits that satisfy the user, and verify your work. All changes are staged until you finish. Honor "only", "just", "keep" and preservation instructions: modify only requested fields, preserve every other field, and do not rewrite an entire site for a small edit. A requested style is a request to update style, not permission to change accent or copy. Tool errors are recoverable: correct arguments or explain that no change could be made. Never use code, shell, environment access, network access, credentials, arbitrary links, or unsupported tools. Never invent testimonials, certifications, customer counts or other factual business claims. Keep generated website copy and your final reply in English, preserving explicit brand names. Use existing service indices; legacy sites use #top, #services, #about or #contact. Composed sites may link their safe internal page slugs and anchors. Do not claim a browser inspection: render_preview only produces HTML and its fingerprint. Do not expose private reasoning. After completing useful edits, validate the site and give a short final reply. Do not emit a full replacement website in your final reply. You have at most ${limits.turns} model turns and ${limits.calls} tool calls.` },
    { role: 'system', content: scope === 'auto' ? 'Edit scope: auto. Choose only the website fields needed by the request.' : `Edit scope: ${scope}. The user locked this edit to ${scope}. Only mutate this scope, even if other content could be improved. Read, validation and preview tools remain available for every section. A tool call targeting another scope will be rejected without changes.` },
    ...(autonomous?[{role:'system',content:`You are an autonomous website builder. ${initial?'This is a NEW BUILD. An empty Home page with id home and slug / already exists: do NOT add that page again; add sections to it. Use plan_site, compose actual pages and sections using the document tools, inspect_site, repair errors, then finish_site. At least a composed home page is required.':'Carry out the requested changes using the smallest tools. You can add pages and sections, rearrange sections and change layouts in Auto scope.'} Use list_sections and list_styles when choosing structure. Add pages before linking them. add_page migrates the legacy home page automatically if needed; keep only useful home sections. For original home copy, use update_page_section (legacy update_section edits the old spec fields, not composed page sections). Batch independent tool calls to make efficient progress. Existing pages and their copy are available through read_site pages. Aesthetics: establish a deliberate visual direction, a strong readable hero, generous consistent spacing, varied section rhythm, one primary CTA, deliberate section layouts (split/alternating/grid/banner) rather than repeating cards. Preserve brand accents unless asked. Never invent pricing, metrics, testimonials or official affiliations; explain unsupported checkout/auth/backend work honestly. Do not claim browser screenshots or visual verification: inspect_site checks structure, internal links, declared requirements and HTML rendering only. Final delivery must distinguish completed, partial and unsupported. Do not replace a website with a full JSON response. Recent project context: ${JSON.stringify(history.slice(-8).map(m=>({role:m.role,content:String(m.content).slice(0,900)})))}`}]:[]),
    { role: 'user', content: JSON.stringify({ request, editScope: scope, ...(style ? { requestedStyle: style } : {}), currentWebsite: { brand: staged.brand, style: staged.style, serviceCount: staged.services.length, pages:staged.pages?.map(p=>({id:p.id,slug:p.slug,sections:p.sections.map(s=>({id:s.id,type:s.type}))})) } }) },
  ];
  let toolCount = 0;
  try {
    for (let turn = 1; turn <= limits.turns; turn++) {
      const reply = assistantMessage(await completeWithinBudget(complete, messages, controller.signal));
      run.modelTurns = turn;
      const calls = reply.tool_calls || [];
      if (!calls.length) {
        if (!reply.content?.trim()) throw agentError(failedMessage);
        const checks=autonomous?inspectAcceptance(staged,context.plan,{initial}):null;
        if(checks&&initial&&!context.outcome)checks.issues.push({severity:'error',code:'outcome_required',message:'Call finish_site after checking the completed work.'});
        if(checks)checks.valid=!checks.issues.some(i=>i.severity==='error');
        if(checks&&!checks.valid&&turn<limits.turns&&!repairPrompted&&context.outcome?.status!=='unsupported'){
          repairPrompted=true;messages.push(reply,{role:'system',content:`Delivery checks found problems. Repair them with tools, inspect again, then finish_site. ${JSON.stringify(checks)}`});continue;
        }
        return deliver(reply.content);
      }
      if (toolCount + calls.length > limits.calls) throw agentError('The website agent reached its tool limit. Your saved website is unchanged; try a smaller request.');
      messages.push({
        ...reply,
        tool_calls: calls.map(call => ({
          ...call,
          function: {
            ...call.function,
            // Rejected oversized or non-string arguments must not inflate the
            // next request. The paired tool observation explains the failure.
            arguments: typeof call.function.arguments === 'string' && Buffer.byteLength(call.function.arguments) <= MAX_ARGUMENT_BYTES ? call.function.arguments : 'null',
          },
        })),
      });
      for (const call of calls) {
        toolCount++;
        const started = performance.now();
        let args, result;
        try {
          args = parseArguments(call.function.arguments);
          result = executeTool(call.function.name, args, staged, scope, context);
          if(result.changedFields.length)context.outcome=null;
        } catch (error) {
          if (!(error instanceof ToolInputError)) throw agentError(failedMessage);
          result = { spec: staged, summary: error.message, changedFields: [], observation: { ok: false, error: error.message, changedFields: [] } };
          args = {};
        }
        staged = result.spec;
        for (const path of result.changedFields) touched.add(path);
        run.steps.push({ id: randomUUID(), tool: call.function.name, arguments: structuredClone(args), ok: result.observation.ok, summary: result.summary, durationMs: Math.max(0, Math.round(performance.now() - started)), changedFields: [...result.changedFields] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.observation) });
      }
      // finish_site already contains the user's delivery summary and checked outcome.
      // Process the whole batch first: a later mutation invalidates that outcome.
      if(autonomous&&context.outcome)return deliver(context.outcome.summary);
      if(autonomous&&turn>=limits.turns-3)messages.push({role:'system',content:`Execution budget: ${limits.turns-turn} model turns and ${limits.calls-toolCount} tool calls remain. Stop repeating successful reads/checks. Batch remaining edits, inspect once, then call finish_site with an honest completed/partial outcome.`});
    }
    throw agentError('The website agent reached its turn limit. Your saved website is unchanged; try a smaller request.');
  } catch (error) {
    const publicError=error?.status===502?error:agentError(failedMessage);
    if(autonomous){const rejected=run.steps.filter(s=>!s.ok);publicError.message+=` Used ${run.modelTurns} model turns and ${run.steps.length} tool calls; ${rejected.length} calls were rejected.${rejected.length?' Last tool error: '+rejected.at(-1).summary:''}`;}
    publicError.agentRun={...run,status:'failed',completedAt:new Date().toISOString(),...(context.plan?{plan:context.plan}:{})};
    throw publicError;
  } finally { clearTimeout(timeout); }
}
