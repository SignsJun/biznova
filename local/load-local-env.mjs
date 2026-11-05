import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// CLI startup only: importing the server in tests never loads real credentials.
// Shell-provided configuration takes precedence over the local file.
export function loadLocalEnv(root) {
  const filename = join(root, '.env.local');
  if (!existsSync(filename)) return;
  const allowed = new Set(['DEEPSEEK_API_KEY', 'BIZNOVA_MODEL_PROVIDER', 'BIZNOVA_DEEPSEEK_MODEL', 'BIZNOVA_OLLAMA_MODEL', 'BIZNOVA_OLLAMA_URL', 'PORT', 'BIZNOVA_DATA_DIR']);
  let values;
  try { values = parseEnv(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Unable to read local server configuration. Check .env.local.'); }
  for (const [name, value] of Object.entries(values)) {
    if (allowed.has(name) && process.env[name] === undefined) process.env[name] = value;
  }
}
