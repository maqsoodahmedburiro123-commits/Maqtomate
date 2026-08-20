import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Owner test sender attachment is explicit, metadata-only, and never uses a hard-coded client ID', () => {
  const portal = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(portal, /owner\/test-tenant\/attach-maqtomate-test-sender/);
  assert.match(portal, /maqtomate_owned_meta_test_asset/);
  assert.match(portal, /credential_stored: false/);
  assert.match(portal, /Maqtomate-owned test sender/);
  assert.match(worker, /business_name = 'Maqtomate Owner Test Tenant'/);
  assert.doesNotMatch(worker, /FROM clients WHERE id = 1/);
});
