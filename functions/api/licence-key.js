// Licence-key service: order number + email in, signed key out. Stateless: no database, no logs, no cookies.
// It asks Lemon Squeezy whether the order is paid (and, for subscriptions, until when), then signs the same
// LZ1 key that tools/issue-licence.mjs makes. Same order and period in, same key out, so asking twice is harmless.
//
// Secrets (wrangler pages secret put NAME --project-name locatorzero):
//   LS_API_KEY        Lemon Squeezy API key
//   LZ_SIGNING_KEY    the Ed25519 signing key: base64 of its PKCS#8 DER, on one line
//   ALLOW_TEST_ORDERS "1" only while testing; test-mode orders are refused otherwise, since anyone can pay with
//                     a test card. Keys for test orders expire after 2 days.

const API = 'https://api.lemonsqueezy.com/v1';
const PRODUCT = 'LocatorZero';
// Grace days cover a late renewal (same as tools/issue-licence.mjs).
const GRACE = { monthly: 7, pro: 14 };
const APP_MAJOR = 1;
const NOT_FOUND = 'We couldn\'t find a paid LocatorZero order with that order number and email. Check both against your receipt, or email locatorzero.help@gmail.com.';

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function planOf(variantName) {
  const n = String(variantName || '').toLowerCase();
  if (n.includes('lifetime')) return 'lifetime';
  if (n.includes('pro') || n.includes('year')) return 'pro';
  if (n.includes('month')) return 'monthly';
  return null;
}

const day = d => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => day(new Date(d).getTime() + n * 864e5);
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function ls(env, path) {
  const res = await fetch(API + path, {
    headers: { Accept: 'application/vnd.api+json', Authorization: 'Bearer ' + env.LS_API_KEY }
  });
  if (!res.ok) throw new Error('store ' + res.status);
  return res.json();
}

async function sign(env, payload) {
  const der = Uint8Array.from(atob(env.LZ_SIGNING_KEY.trim()), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(body));
  return 'LZ1.' + body + '.' + b64u(sig);
}

export async function onRequestPost({ request, env }) {
  if (!env.LS_API_KEY || !env.LZ_SIGNING_KEY) return reply(503, { error: 'The key service isn\'t switched on yet. Email locatorzero.help@gmail.com and we\'ll send your key.' });

  let input;
  try { input = await request.json(); } catch { return reply(400, { error: 'Send an order number and email.' }); }
  const number = String(input.order || '').replace(/[#\s]/g, '');
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^\d{1,12}$/.test(number) || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    return reply(400, { error: 'Enter the order number from your receipt (digits only) and the email you paid with.' });
  }

  try {
    const orders = await ls(env, '/orders?filter[user_email]=' + encodeURIComponent(email) + '&page[size]=100');
    const order = (orders.data || []).find(o => String(o.attributes.order_number) === number &&
      String(o.attributes.user_email || '').toLowerCase() === email);
    const a = order && order.attributes;
    const item = a && a.first_order_item;
    const plan = item && planOf(item.variant_name);
    if (!a || a.status !== 'paid' || a.refunded || !item || item.product_name !== PRODUCT || !plan) return reply(404, { error: NOT_FOUND });
    if (a.test_mode && env.ALLOW_TEST_ORDERS !== '1') return reply(404, { error: NOT_FOUND });

    const payload = { v: 1, plan, ref: (a.test_mode ? 'TEST-' : '') + number, iss: day(a.created_at), exp: null };
    if (plan === 'lifetime') {
      payload.major = APP_MAJOR;
    } else {
      const subs = await ls(env, '/subscriptions?filter[order_id]=' + encodeURIComponent(order.id));
      const s = subs.data && subs.data[0] && subs.data[0].attributes;
      if (!s) return reply(404, { error: NOT_FOUND });
      // Active (or retrying a failed payment): valid to the next renewal. Cancelled: to the end of the paid period.
      const until = ['active', 'on_trial', 'past_due'].includes(s.status) ? s.renews_at : s.status === 'cancelled' ? s.ends_at : null;
      if (!until) return reply(410, { error: 'This subscription has ended. Renew it from the link in your receipt, then come back for a fresh key.' });
      payload.exp = addDays(until, GRACE[plan]);
    }
    if (a.test_mode) payload.exp = addDays(Date.now(), 2);
    return reply(200, { key: await sign(env, payload), plan, expires: payload.exp });
  } catch (e) {
    return reply(502, { error: 'The store didn\'t answer just now. Please try again in a minute.' });
  }
}

export function onRequest() {
  return reply(405, { error: 'Use POST.' });
}
