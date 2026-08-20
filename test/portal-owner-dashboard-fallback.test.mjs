import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Owner dashboard has a server-rendered live overview fallback', () => {
  const source = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  assert.match(source, /dashboardHTML\(access\.user, overview, access\.platformRole\)/);
  assert.match(source, /async function ownerOverviewData\(env\)/);
  assert.match(source, /Live overview rendered securely by the server/);
  assert.match(source, /const ownerClass = platformRole \? '' : 'hidden';/);
  assert.match(source, /id="owner-app" class="\$\{ownerClass\}"/);
});
