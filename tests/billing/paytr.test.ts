// npx tsx --test tests/billing/paytr.test.ts
// Saf mantik testleri: merchant_oid eslemesi ve bildirim hash'i (PayTR sandbox/canli testi DEGILDIR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { intentIdToOid, oidToIntentId, verifyPaytrCallbackHash } from '../../supabase/functions/_shared/paytr.ts';

const ID = '3f2a9c1e-7b44-4d0a-9a51-0c8e6f1b2d34';

test('oid <-> intent id gidis-donus', () => {
  const oid = intentIdToOid(ID);
  assert.match(oid, /^PRD[0-9a-f]{32}$/);
  assert.equal(oidToIntentId(oid), ID);
});

test('baska urunun oneki (MTR) kabul edilmez', () => {
  assert.equal(oidToIntentId('MTR' + ID.replace(/-/g, '')), null);
  assert.equal(oidToIntentId('PRDxyz'), null);
});

test('bildirim hash dogrulamasi', async () => {
  const key = 'k', salt = 's';
  const p = { merchant_oid: intentIdToOid(ID), status: 'success', total_amount: '10000' };
  const hash = createHmac('sha256', key).update(p.merchant_oid + salt + p.status + p.total_amount).digest('base64');
  assert.equal(await verifyPaytrCallbackHash({ ...p, hash }, key, salt), true);
  assert.equal(await verifyPaytrCallbackHash({ ...p, total_amount: '1', hash }, key, salt), false);
  assert.equal(await verifyPaytrCallbackHash({ ...p, hash: 'x' }, key, salt), false);
});
