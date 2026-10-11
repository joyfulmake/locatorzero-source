# Pricing, licence keys and selling

## Plans

| Plan | Price | What it is |
|---|---|---|
| Web app | Free | The hosted web app at locatorzero.pages.dev, for folders you choose. It is the shop window |
| Desktop trial | Free for 90 days | Everything: whole computer, drives, cloud folders, browsers, open tabs, map, preview |
| Monthly | **$3 / month** | Same as the trial, renewed monthly, cancel any time |
| Pro | **$25 / year** | Same, renewed yearly. About $2 a month, 30% less than monthly |
| Lifetime | **$35 once** | Same, never expires, for the current major version |

Prices are for buyers outside India. **India pricing is still to be set**: local purchasing power suggests roughly
₹299 a year or ₹999 lifetime as a starting point.

**Decided (8 Oct 2026):** Lifetime covers one major version: every update within version 1, but not a future
version 2. Lifetime keys carry `"major": 1`, and the app refuses a Lifetime key from an earlier major version.

## How the trial and keys work

```
first launch ──► licence.json gets the date ──► 90 days of full use ──► gentle reminder at 15 days left
                                                                          │
                     store email: LZ1.<plan, order ref, dates>.<signature>
                                                                          ▼
                        paste key ──► app checks the signature offline ──► unlocked
```

- **Format.** `LZ1.` + base64url of `{"v":1,"plan":"pro","ref":"ORDER-123","iss":"2026-10-08","exp":"2027-10-22"}`
  + `.` + an Ed25519 signature. Monthly keys run 31 days plus 7 days' grace, Pro keys 365 plus 14, Lifetime never
  expires (Lifetime keys also carry `"major": 1`).
- **Checking.** The app embeds only the public key (`desktop/src-tauri/src/licence.rs`), so it can check a key
  but never make one. No activation server, no phone-home, no device ID.
- **Issuing.** `node tools/issue-licence.mjs --plan pro --ref ORDER-123`. The private key is in
  `locatorzero-private/secrets/licence-signing.pem`, outside every repository. If it leaks, anyone can mint keys:
  keep a second copy offline, and know that replacing it means shipping an app update with the new public key.
- **When the trial ends.** Searching the computer and preview pause, with a friendly plans screen. Nothing is
  deleted, and the web app keeps working.
- **Accepted limit.** The trial clock is a local date, so a determined user can reset it by deleting
  `licence.json`. At $3 a month, honest users are the market; hard copy protection would cost more trust than it
  saves.

## Selling without keeping data: the plan

| Step | Who | What we keep |
|---|---|---|
| Checkout, payment, tax, invoice, refunds | **Lemon Squeezy** (chosen 8 Oct 2026) as merchant of record | Nothing. Lemon Squeezy is the legal seller and keeps the records the law requires |
| Issue the key | A small stateless function (for example a Cloudflare Worker) holding the signing key as a secret. Lemon Squeezy's `order_created` and `subscription_payment_success` webhooks, or the buyer's thank-you page, send it the order reference;  it checks the order with the store and returns the signed key | Nothing. The same order always produces the same key, so a lost key can be re-fetched without a database |
| Monthly and yearly renewals | The store charges; the same function issues the next period's key, delivered in the store's renewal email or thank-you page | Nothing |
| Support and refunds | The store's dashboard | Nothing outside the store |

India: a merchant of record that collects Indian GST, or a separate Indian checkout (for example Razorpay),
which makes us the seller there, with Indian invoicing and record-keeping duties.

## What the law usually requires for any purchase

**Not legal advice.** This is the checklist to take to a lawyer and an accountant. A merchant of record takes on
most of it, marked ✦.

1. **A legal seller identity.** A registered business or sole proprietor, with a contact address and email shown
   on the site. India's Consumer Protection (E-Commerce) Rules 2020 also ask e-commerce sellers for a grievance
   officer.
2. **Terms of sale (EULA)** accepted at checkout: the LICENSE plus plan, renewal and refund terms.
3. **Refund and cancellation policy**, published. In the EU and UK, buyers of digital content have a 14-day
   withdrawal right unless they expressly agree to immediate delivery and acknowledge losing it at checkout. ✦
4. **A privacy notice** covering purchase data: [PRIVACY.md](../PRIVACY.md) has a draft section.
5. **Sales tax collected and paid where the buyer lives**: EU VAT, UK VAT, Indian GST (including the rules for
   foreign suppliers of digital services), and US sales tax in states that tax digital goods. ✦
6. **Invoices with tax details, and records kept** for the years each tax authority requires. ✦
7. **Subscriptions:** clear renewal terms, easy cancellation, and renewal reminders where the law requires them
   (several US states). In India, recurring card payments follow RBI e-mandate rules: extra authentication and a
   notice before each charge. ✦
8. **Prices shown including tax** to consumers in the EU, UK and India. ✦
9. **Export controls:** the app uses cryptography only to check licence signatures, which is usually outside
   export restrictions. Confirm once.

What LocatorZero itself must keep, if a merchant of record sells for us: nothing beyond what the store's
dashboard already holds. If we sell directly anywhere (for example India via our own gateway), we become the
seller there and must keep that country's invoices and tax records ourselves.
