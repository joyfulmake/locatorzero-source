// Issue a LocatorZero licence key, offline.
//
//   node tools/issue-licence.mjs --init                      create the signing key pair (once)
//   node tools/issue-licence.mjs --plan lifetime --ref ORDER-123
//   node tools/issue-licence.mjs --plan monthly  --ref SUB-9 --from 2026-11-01
//
// A key holds only: plan, the store's order reference, issue date, expiry. No name, no email, no device id.
// The private key never leaves locatorzero-private/secrets (git-ignored). The app embeds only the public key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const keyPath = process.env.LZ_SIGNING_KEY || path.resolve(here, '../../locatorzero-private/secrets/licence-signing.pem');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const b64u = b => Buffer.from(b).toString('base64url');

// Plans and how long each key stays valid. Grace days cover a late renewal email.
const PLANS = { monthly: { days: 31, grace: 7 }, pro: { days: 365, grace: 14 }, lifetime: null };

if (process.argv.includes('--init')) {
  if (fs.existsSync(keyPath)) { console.error('Refusing to overwrite ' + keyPath); process.exit(1); }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  console.log('Private key written to ' + keyPath + ' (keep it out of every repository)');
  console.log('Public key for desktop/src-tauri/src/licence.rs:\n' + raw.toString('hex'));
  process.exit(0);
}

const plan = arg('plan'), ref = arg('ref');
if (!(plan in PLANS) || !ref) {
  console.error('Usage: --plan monthly|pro|lifetime --ref <store order reference> [--from YYYY-MM-DD]');
  process.exit(1);
}
const from = arg('from') ? new Date(arg('from') + 'T00:00:00Z') : new Date();
const day = d => d.toISOString().slice(0, 10);
const p = PLANS[plan];
// Lifetime covers one major version: every update within it, not the next major release.
const APP_MAJOR = 1;
const payload = { v: 1, plan, ref, iss: day(from), exp: p ? day(new Date(from.getTime() + (p.days + p.grace) * 864e5)) : null };
if (plan === 'lifetime') payload.major = APP_MAJOR;
const body = b64u(JSON.stringify(payload));
const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(fs.readFileSync(keyPath)));
console.log('LZ1.' + body + '.' + b64u(sig));
