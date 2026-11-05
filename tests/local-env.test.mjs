import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnv } from '../local/load-local-env.mjs';

test('Local secrets are loaded only on request, respect shell overrides and ignore unrelated variables', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'biznova-env-'));
  const names = ['DEEPSEEK_API_KEY','BIZNOVA_MODEL_PROVIDER','BIZNOVA_DEEPSEEK_MODEL'];
  const previous = Object.fromEntries(names.map(n => [n, process.env[n]]));
  const originalHome = process.env.HOME;
  try {
    for (const name of names) delete process.env[name];
    await writeFile(join(directory,'.env.local'), 'DEEPSEEK_API_KEY="fake-unit-test-key"\nBIZNOVA_MODEL_PROVIDER=deepseek\nBIZNOVA_DEEPSEEK_MODEL=deepseek-flash\nHOME=/not-allowed\n');
    assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
    process.env.BIZNOVA_DEEPSEEK_MODEL = 'shell-selected-model';
    loadLocalEnv(directory);
    assert.equal(process.env.DEEPSEEK_API_KEY,'fake-unit-test-key');
    assert.equal(process.env.BIZNOVA_MODEL_PROVIDER,'deepseek');
    assert.equal(process.env.BIZNOVA_DEEPSEEK_MODEL,'shell-selected-model');
    assert.equal(process.env.HOME,originalHome);
  } finally {
    for (const name of names) if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
    await rm(directory,{recursive:true,force:true});
  }
});
