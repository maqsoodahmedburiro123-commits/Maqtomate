import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Owner Control Center browser script has valid JavaScript syntax', () => {
  const source = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const ownerScript = scripts.find(script => script.includes('Loading your secure dashboard') || script.includes('async function init'));
  assert.ok(ownerScript, 'Owner dashboard browser script must be present');

  const dir = mkdtempSync(join(tmpdir(), 'maqtomate-portal-client-'));
  const file = join(dir, 'owner-dashboard-client.js');
  try {
    writeFileSync(file, ownerScript);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
