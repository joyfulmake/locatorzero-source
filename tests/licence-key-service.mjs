// Tests functions/api/licence-key.js against a fake Lemon Squeezy API, with a throwaway signing key.
// The keys it issues must verify with the matching public key, exactly as the desktop app checks them.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/licence-key.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const env = { LS_API_KEY: 'test', LZ_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
const order = (n, variant, extra = {}) => ({ id: String(9000 + n), attributes: { order_number: n, user_email: 'Buyer@Example.com', status: 'paid', refunded: false,
  test_mode: false, created_at: '2026-10-11T10:00:00Z', first_order_item: { product_name: 'LocatorZero', variant_name: variant }, ...extra } });
const ORDERS = [order(1001, 'Lifetime (v1)'), order(1002, 'Monthly'), order(1003, 'Pro (yearly)'), order(1004, 'Monthly', { refunded: true, status: 'refunded' }),
  order(1005, 'Lifetime (v1)', { test_mode: true }), order(1006, 'Monthly')];
const SUBS = { 10002: { status: 'active', renews_at: '2026-11-11T10:00:00Z' }, 10003: { status: 'cancelled', ends_at: '2027-10-11T10:00:00Z' }, 10006: { status: 'expired' } };
globalThis.fetch = async url => {
  const u = new URL(url);
  let data = [];
  if (u.pathname === '/v1/orders') data = ORDERS.filter(o => o.attributes.user_email.toLowerCase() === u.searchParams.get('filter[user_email]'));
  if (u.pathname === '/v1/subscriptions') { const s = SUBS[u.searchParams.get('filter[order_id]')]; data = s ? [{ attributes: s }] : []; }
  return new Response(JSON.stringify({ data }), { status: 200 });
};
const ask = async (body, e = env) => { const r = await onRequestPost({ request: new Request('https://x/api/licence-key', { method: 'POST', body: JSON.stringify(body) }), env: e }); return [r.status, await r.json()]; };
const claims = key => {
  const [tag, body, sig] = key.split('.');
  assert.equal(tag, 'LZ1');
  assert.ok(crypto.verify(null, Buffer.from(body), publicKey, Buffer.from(sig, 'base64url')), 'signature verifies');
  return JSON.parse(Buffer.from(body, 'base64url'));
};

let [s, d] = await ask({ order: '#1001', email: ' buyer@example.com ' });
assert.equal(s, 200); assert.deepEqual(claims(d.key), { v: 1, plan: 'lifetime', ref: '1001', iss: '2026-10-11', exp: null, major: 1 });
const again = (await ask({ order: '1001', email: 'buyer@example.com' }))[1].key;
assert.equal(again, d.key, 'same order gives the same key');
[s, d] = await ask({ order: '1002', email: 'buyer@example.com' });
assert.equal(s, 200); assert.equal(claims(d.key).exp, '2026-11-18'); assert.equal(d.plan, 'monthly');
[s, d] = await ask({ order: '1003', email: 'buyer@example.com' });
assert.equal(s, 200); assert.equal(claims(d.key).exp, '2027-10-25');
assert.equal((await ask({ order: '1001', email: 'other@example.com' }))[0], 404, 'wrong email');
assert.equal((await ask({ order: '1999', email: 'buyer@example.com' }))[0], 404, 'unknown order');
assert.equal((await ask({ order: '1004', email: 'buyer@example.com' }))[0], 404, 'refunded');
assert.equal((await ask({ order: '1005', email: 'buyer@example.com' }))[0], 404, 'test order refused by default');
[s, d] = await ask({ order: '1005', email: 'buyer@example.com' }, { ...env, ALLOW_TEST_ORDERS: '1' });
assert.equal(s, 200); assert.equal(claims(d.key).ref, 'TEST-1005');
assert.equal((await ask({ order: '1006', email: 'buyer@example.com' }))[0], 410, 'expired subscription');
assert.equal((await ask({ order: 'abc', email: 'buyer@example.com' }))[0], 400);
assert.equal((await ask({ order: '1001', email: 'buyer@example.com' }, {}))[0], 503, 'not configured');
console.log('licence-key service: 12 checks passed');
