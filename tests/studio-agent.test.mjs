import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeSpec, renderSite } from '../local/site-generator.mjs';
import { runWebsiteAgent, WEBSITE_AGENT_TOOLS, WebsiteAgentProviderError } from '../local/studio-agent.mjs';
import { STYLE_IDS } from '../lib/studio-styles.ts';

const site = () => normalizeSpec({ brand: 'Northstar', accent: '#123456' });
const final = (content = 'Finished the requested edits.') => ({ role: 'assistant', content });
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const calling = (...calls) => ({ role: 'assistant', content: null, tool_calls: calls });
const observations = messages => messages.filter(message => message.role === 'tool').map(message => ({ id: message.tool_call_id, ...JSON.parse(message.content) }));

function scripted(responses) {
  const history = [], signals = [];
  const complete = async (messages, tools, options) => {
    history.push(structuredClone(messages));
    signals.push(options.signal);
    assert.deepEqual(tools, WEBSITE_AGENT_TOOLS);
    assert.ok(options.signal instanceof AbortSignal);
    const response = responses[history.length - 1];
    assert.ok(response, 'The runner must not make an unexpected completion or retry.');
    return typeof response === 'function' ? response(messages) : response;
  };
  return { complete, history, signals };
}

test('Agent performs real multi-round tools and observes every result before deciding again', async () => {
  const current = site(), original = structuredClone(current);
  const model = scripted([
    calling(call('read', 'read_site', { section: 'hero' })),
    messages => {
      const results = observations(messages);
      assert.equal(results.length, 1);
      assert.equal(results[0].website.headline, original.headline);
      return calling(call('edit', 'update_section', { section: 'hero', changes: { headline: 'A clearer next chapter.' } }), call('check', 'validate_site', {}));
    },
    messages => {
      assert.deepEqual(messages.slice(-3).map(message => message.role), ['assistant', 'tool', 'tool']);
      assert.deepEqual(observations(messages).map(result => result.id), ['read', 'edit', 'check']);
      assert.deepEqual(observations(messages)[1].changedFields, ['headline']);
      assert.equal(observations(messages)[2].valid, true);
      return final('My private reasoning should never enter the audit log.');
    },
  ]);
  const result = await runWebsiteAgent({ current, request: 'Only change the headline to A clearer next chapter.', complete: model.complete });
  assert.deepEqual(current, original);
  assert.deepEqual(result.spec, { ...original, headline: 'A clearer next chapter.' });
  assert.equal(result.changed, true);
  assert.equal(result.agentRun.modelTurns, 3);
  assert.deepEqual(result.agentRun.changedFields, ['headline']);
  assert.deepEqual(result.agentRun.steps.map(step => step.tool), ['read_site', 'update_section', 'validate_site']);
  assert.ok(result.agentRun.steps.every(step => step.ok && Number.isInteger(step.durationMs) && step.durationMs >= 0));
  assert.equal(result.agentRun.status, 'completed');
  assert.match(result.agentRun.id, /^[a-f\d-]{36}$/i);
  assert.ok(Date.parse(result.agentRun.completedAt) >= Date.parse(result.agentRun.startedAt));
  assert.ok(model.signals.every(signal => signal === model.signals[0]));
  assert.ok(!JSON.stringify(result).includes('private reasoning'));
  assert.match(result.summary, /hero headline/);
});

test('Scoped edits preserve every unrelated field, including noncanonical legacy copy', async () => {
  const current = site();
  current.tagline = '让团队专注真正重要的事';
  current.footer = '  Custom footer spacing.  ';
  current.accent = '#AbCdEf';
  const original = structuredClone(current);
  const model = scripted([
    calling(call('service', 'update_service', { index: 1, description: 'A more focused service description.' }), call('style', 'update_theme', { style: 'editorial' })),
    final(),
  ]);
  const result = await runWebsiteAgent({ current, request: 'Change just the second service description and switch the style to editorial.', style: 'editorial', complete: model.complete });
  const expected = structuredClone(original);
  expected.services[1].description = 'A more focused service description.';
  expected.style = 'editorial';
  assert.deepEqual(result.spec, expected);
  assert.deepEqual(current, original);
  assert.deepEqual(result.agentRun.changedFields, ['style', 'services.1.description']);
  assert.deepEqual(result.agentRun.steps[0].changedFields, ['services.1.description']);
  assert.deepEqual(result.agentRun.steps[1].changedFields, ['style']);
});

test('Footer scope rejects a hero mutation, observes the error, and permits only a footer update', async () => {
  const current = site(), original = structuredClone(current);
  const model = scripted([
    messages => {
      assert.ok(messages.some(message => message.role === 'system' && /Edit scope: footer/.test(message.content)));
      assert.equal(JSON.parse(messages.at(-1).content).editScope, 'footer');
      return calling(call('read', 'read_site', { section: 'hero' }), call('blocked', 'update_section', { section: 'hero', changes: { headline: 'Must stay unchanged' } }));
    },
    messages => {
      const results = observations(messages);
      assert.equal(results[0].ok, true);
      assert.equal(results[1].ok, false);
      assert.match(results[1].error, /locked to footer/);
      assert.deepEqual(results[1].changedFields, []);
      return calling(call('footer', 'update_section', { section: 'footer', changes: { footer: 'Made with care.' } }), call('validate', 'validate_site', {}), call('preview', 'render_preview', {}));
    },
    final(),
  ]);
  const result = await runWebsiteAgent({ current, request: 'Only update the footer.', scope: 'footer', complete: model.complete });
  assert.deepEqual(current, original);
  assert.deepEqual(result.spec, { ...original, footer: 'Made with care.' });
  assert.equal(result.agentRun.scope, 'footer');
  assert.deepEqual(result.agentRun.changedFields, ['footer']);
  assert.deepEqual(result.agentRun.steps.map(step => step.ok), [true, false, true, true, true]);
});

test('Every explicit scope enforces mutating tool targets while auto remains unrestricted', async () => {
  const edits = [
    ['hero', 'update_section', { section: 'hero', changes: { headline: 'A new headline.' } }],
    ['about', 'update_section', { section: 'about', changes: { aboutTitle: 'Meet our people.' } }],
    ['footer', 'update_section', { section: 'footer', changes: { footer: 'A new footer.' } }],
    ['contact', 'update_section', { section: 'contact', changes: { email: 'team@example.com' } }],
    ['brand', 'update_section', { section: 'brand', changes: { brand: 'A new brand' } }],
    ['services', 'update_service', { index: 0, title: 'A new service' }],
    ['theme', 'update_theme', { accent: '#112233' }],
    ['navigation', 'update_navigation', { items: [{ label: 'Contact', href: '#contact' }] }],
  ];
  for (const scope of ['auto', ...edits.map(([scope]) => scope)]) {
    const current = site();
    const model = scripted([calling(...edits.map(([, name, args], index) => call(`edit${index}`, name, args))), final()]);
    const result = await runWebsiteAgent({ current, request: 'Update only the selected edit scope.', scope, complete: model.complete });
    assert.deepEqual(result.agentRun.steps.map(step => step.ok), edits.map(([target]) => scope === 'auto' || scope === target));
    if (scope !== 'auto') assert.equal(result.agentRun.steps.filter(step => step.changedFields.length > 0).length, 1);
  }
  let completions = 0;
  await assert.rejects(runWebsiteAgent({ current: site(), request: 'Update the website.', scope: 'invalid', complete: async () => { completions++; return final(); } }), error => error.status === 502);
  assert.equal(completions, 0);
});

test('Toy storefront layout is explicit, theme-scoped and compatible with legacy specifications', async () => {
  const current = site();
  delete current.pageType;
  const model = scripted([
    calling(call('layout', 'update_theme', {pageType:'toy-store'})),
    final(),
  ]);
  const result = await runWebsiteAgent({current,request:'Use a building-toy storefront layout.',scope:'theme',complete:model.complete});
  assert.deepEqual(result.spec,{...current,pageType:'toy-store'});
  assert.deepEqual(result.agentRun.changedFields,['pageType']);
  const locked = scripted([calling(call('layout','update_theme',{pageType:'toy-store'})),final()]);
  const rejected = await runWebsiteAgent({current,request:'Only change the headline.',scope:'hero',complete:locked.complete});
  assert.deepEqual(rejected.spec,current);
  assert.equal(rejected.agentRun.steps[0].ok,false);
  const invalid = scripted([calling(call('layout','update_theme',{pageType:'custom-code'})),final()]);
  const unsupported = await runWebsiteAgent({current,request:'Change the layout.',complete:invalid.complete});
  assert.deepEqual(unsupported.spec,current);
  assert.equal(unsupported.agentRun.steps[0].ok,false);
});

test('The model can inspect nine styles in any scope, then patch only a selected style',async()=>{
  const current=site();
  const inspector=scripted([
    calling(call('catalog','list_styles',{})),
    messages=>{const catalog=observations(messages)[0];assert.deepEqual(catalog.styles.map(s=>s.id),[...STYLE_IDS]);return final();},
  ]);
  const inspected=await runWebsiteAgent({current,request:'Show available design directions.',scope:'footer',complete:inspector.complete});
  assert.deepEqual(inspected.spec,current);assert.deepEqual(inspected.agentRun.changedFields,[]);
  for(const style of STYLE_IDS.filter(id=>id!==current.style)){
    const model=scripted([calling(call('style','update_theme',{style})),final()]);
    const result=await runWebsiteAgent({current,request:`Switch only style to ${style}.`,scope:'theme',complete:model.complete});
    assert.deepEqual(result.spec,{...current,style});assert.deepEqual(result.agentRun.changedFields,['style']);
  }
});

test('Unsupported tools, unsafe objects, malformed arguments and indices are recoverable observations', async () => {
  const current = site();
  const model = scripted([
    calling(
      call('unknown', 'execute_shell', { command: 'echo must never execute' }),
      call('json', 'update_theme', '{not json'),
      call('proto', 'update_theme', '{"__proto__":{"polluted":true}}'),
      call('index', 'update_service', { index: 99, title: 'Invalid' }),
      call('scope', 'update_section', { section: 'hero', changes: { footer: 'Wrong section' } }),
    ),
    messages => {
      const results = observations(messages);
      assert.equal(results.length, 5);
      assert.ok(results.every(result => result.ok === false && result.error && result.changedFields.length === 0));
      assert.deepEqual(results.map(result => result.id), ['unknown', 'json', 'proto', 'index', 'scope']);
      return calling(call('recover', 'update_section', { section: 'footer', changes: { footer: 'Made with care.' } }));
    },
    final(),
  ]);
  const result = await runWebsiteAgent({ current, request: 'Change the footer to Made with care.', complete: model.complete });
  assert.deepEqual(result.spec, { ...current, footer: 'Made with care.' });
  assert.equal(result.agentRun.steps.length, 6);
  assert.ok(result.agentRun.steps.slice(0, 5).every(step => !step.ok && Object.keys(step.arguments).length === 0));
  assert.equal({}.polluted, undefined);
  assert.deepEqual(result.agentRun.changedFields, ['footer']);
});

test('Invalid theme, navigation, extra fields and oversized arguments never reach staged website fields', async () => {
  const current = site();
  const model = scripted([
    calling(
      call('style', 'update_theme', { style: 'custom' }),
      call('color', 'update_theme', { accent: 'red; display:none' }),
      call('link', 'update_navigation', { items: [{ label: 'Unsafe', href: 'javascript:alert(1)' }] }),
      call('extra', 'update_service', { index: 0, title: 'New title', shell: 'whoami' }),
      call('large', 'update_section', JSON.stringify({ section: 'hero', changes: { headline: 'x'.repeat(8192) } })),
      call('key', 'update_section', { section: 'brand', changes: { brand: `sk-${'x'.repeat(24)}` } }),
    ),
    messages => {
      assert.ok(observations(messages).every(result => result.ok === false));
      assert.ok(messages.filter(message => message.tool_calls).flatMap(message => message.tool_calls).every(call => Buffer.byteLength(call.function.arguments) <= 8192));
      return final('Everything was changed.');
    },
  ]);
  const result = await runWebsiteAgent({ current, request: 'Make a small update.', complete: model.complete });
  assert.deepEqual(result.spec, current);
  assert.equal(result.changed, false);
  assert.deepEqual(result.agentRun.changedFields, []);
  assert.match(result.summary, /^No website fields changed\./);
  assert.ok(!JSON.stringify(result).includes(`sk-${'x'.repeat(24)}`));
});

test('All supported editing tools use documented keys and preserve scoped values', async () => {
  const current = site();
  const nav = [{ label: 'Services', href: '#services' }, { label: 'Contact', href: '#contact' }];
  const model = scripted([
    calling(
      call('brand', 'update_section', { section: 'brand', changes: { brand: 'Northstar & Co.' } }),
      call('contact', 'update_section', { section: 'contact', changes: { email: 'team@northstar.example' } }),
      call('about', 'update_section', { section: 'about', changes: { aboutTitle: 'Meet our team', aboutText: 'Thoughtful people, considered work.' } }),
      call('navigation', 'update_navigation', { items: nav }),
      call('theme', 'update_theme', { accent: '#987abc' }),
      call('hero', 'update_section', { section: 'hero', changes: { ctaLabel: '  Talk to us  ' } }),
    ),
    final(),
  ]);
  const result = await runWebsiteAgent({ current, request: 'Update the brand, contact, about, navigation, accent and CTA as discussed.', complete: model.complete });
  assert.deepEqual(result.spec, { ...current, brand: 'Northstar & Co.', email: 'team@northstar.example', aboutTitle: 'Meet our team', aboutText: 'Thoughtful people, considered work.', nav, accent: '#987abc', ctaLabel: 'Talk to us' });
  assert.ok(result.agentRun.steps.every(step => step.ok));
});

test('Preview tool invokes the actual renderer and reports an honest HTML fingerprint', async () => {
  const current = site(), html = renderSite(current, { preview: true });
  const model = scripted([
    calling(call('preview', 'render_preview', {})),
    messages => {
      const result = observations(messages)[0];
      assert.equal(result.rendered, true);
      assert.equal(result.htmlBytes, Buffer.byteLength(html));
      assert.equal(result.sha256, createHash('sha256').update(html).digest('hex'));
      assert.equal(result.browserInspection, false);
      assert.ok(!JSON.stringify(result).includes('<!doctype'));
      return final('Rendered the HTML.');
    },
  ]);
  const result = await runWebsiteAgent({ current, request: 'Render the current preview.', complete: model.complete });
  assert.equal(result.changed, false);
  assert.deepEqual(result.spec, current);
});

test('Final prose alone cannot replace the website or fabricate a successful edit', async () => {
  const current = site();
  const model = scripted([final(JSON.stringify({ headline: 'Ignored replacement' }))]);
  const result = await runWebsiteAgent({ current, request: 'Change the headline.', complete: model.complete });
  assert.deepEqual(result.spec, current);
  assert.equal(result.changed, false);
  assert.match(result.summary, /^No website fields changed/);
  assert.equal(result.agentRun.steps.length, 0);
});

test('Edits reverted during the run produce an honest final no-op', async () => {
  const current = site();
  const model = scripted([
    calling(call('edit', 'update_section', { section: 'hero', changes: { headline: 'Temporary copy' } })),
    calling(call('revert', 'update_section', { section: 'hero', changes: { headline: current.headline } })),
    final(),
  ]);
  const result = await runWebsiteAgent({ current, request: 'Try a headline and retain the original if it is better.', complete: model.complete });
  assert.equal(result.changed, false);
  assert.deepEqual(result.agentRun.changedFields, []);
  assert.deepEqual(result.spec, current);
  assert.ok(result.agentRun.steps.every(step => step.changedFields.includes('headline')));
});

test('Turn limit rolls back staged edits and never retries a model completion', async () => {
  const current = site(), original = structuredClone(current);
  const responses = Array.from({ length: 6 }, (_, index) => calling(call(`turn${index}`, 'update_section', { section: 'hero', changes: { headline: `Staged headline ${index}` } })));
  const model = scripted(responses);
  await assert.rejects(runWebsiteAgent({ current, request: 'Improve the headline.', complete: model.complete }), error => error.status === 502 && /turn limit/.test(error.message));
  assert.equal(model.history.length, 6);
  assert.deepEqual(current, original);
});

test('Tool limit rejects excess batches and permits exactly twelve calls followed by final reply', async () => {
  const current = site();
  const excessive = scripted([calling(...Array.from({ length: 13 }, (_, index) => call(`tool${index}`, 'validate_site', {})))]);
  await assert.rejects(runWebsiteAgent({ current, request: 'Validate the website.', complete: excessive.complete }), error => error.status === 502 && /tool limit/.test(error.message));
  assert.equal(excessive.history.length, 1);
  const bounded = scripted([calling(...Array.from({ length: 12 }, (_, index) => call(`tool${index}`, 'validate_site', {}))), final()]);
  const result = await runWebsiteAgent({ current, request: 'Validate the website.', complete: bounded.complete });
  assert.equal(result.agentRun.steps.length, 12);
  assert.equal(observations(bounded.history[1]).length, 12);
  assert.equal(result.agentRun.modelTurns, 2);
});

test('Provider errors and incomplete final messages preserve original website and expose no raw error', async () => {
  for (const failure of [() => { throw new Error('Provider body includes private credentials and raw debug payload'); }, () => { throw Object.assign(new Error('Provider body includes private credentials and raw debug payload'), { status: 502, safeForClient: true }); }, { role: 'assistant', content: null }, { role: 'user', content: 'wrong role' }]) {
    const current = site(), original = structuredClone(current);
    const model = scripted([calling(call('edit', 'update_section', { section: 'hero', changes: { headline: 'Never committed' } })), failure]);
    await assert.rejects(runWebsiteAgent({ current, request: 'Update the headline.', complete: model.complete }), error => error.status === 502 && !/private credentials|debug payload/.test(error.message));
    assert.deepEqual(current, original);
    assert.equal(model.history.length, 2);
  }
});

test('Only explicitly sanitized provider errors retain actionable guidance and roll back staged changes', async () => {
  for (const message of [
    'DeepSeek authentication failed. Check DEEPSEEK_API_KEY on the local server.',
    'The DeepSeek account has insufficient balance. Add API credit before trying again.',
    'DeepSeek is rate limited. Wait a moment before trying again.',
  ]) {
    const current = site(), original = structuredClone(current);
    const failure = new WebsiteAgentProviderError(message);
    const model = scripted([
      calling(call('edit', 'update_section', { section: 'hero', changes: { headline: 'Never committed' } })),
      () => { throw failure; },
    ]);
    await assert.rejects(runWebsiteAgent({ current, request: 'Update the headline.', complete: model.complete }), error => error === failure && error.status === 502 && error.message === message);
    assert.deepEqual(current, original);
    assert.equal(model.history.length, 2);
  }
});

test('Shared 120 second deadline aborts even an uncooperative completion without retrying', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  const current = site(), original = structuredClone(current);
  const running = runWebsiteAgent({ current, request: 'Improve the website.', complete: async (messages, tools, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  } });
  await Promise.resolve();
  assert.equal(calls, 1);
  context.mock.timers.tick(119_999);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await assert.rejects(running, error => error.status === 502 && /timed out/.test(error.message));
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.deepEqual(current, original);
});

test('Invalid current specifications fail before a model call instead of being repaired by normalization', async () => {
  for (const current of [
    { ...site(), accent: 'invalid' },
    { ...site(), headline: 'x'.repeat(221) },
    { ...site(), services: [{ title: 'Missing description' }] },
    { ...site(), unexpected: 'extra field' },
    { ...site(), nav: [{ label: 'External', href: 'https://example.com' }] },
  ]) {
    let calls = 0;
    await assert.rejects(runWebsiteAgent({ current, request: 'Change the headline.', complete: async () => { calls++; return final(); } }), error => error.status === 502);
    assert.equal(calls, 0);
  }
});

test('Function definitions use standard OpenAI tool envelopes with closed JSON object schemas', () => {
  assert.deepEqual(WEBSITE_AGENT_TOOLS.map(tool => tool.function.name), ['list_styles', 'read_site', 'update_section', 'update_service', 'update_theme', 'update_navigation', 'validate_site', 'render_preview']);
  for (const tool of WEBSITE_AGENT_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.parameters.type, 'object');
    assert.equal(tool.function.parameters.additionalProperties, false);
    assert.ok(Array.isArray(tool.function.parameters.required));
    assert.ok(tool.function.description.length > 10);
  }
});
