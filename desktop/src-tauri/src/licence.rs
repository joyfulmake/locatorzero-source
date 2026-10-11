//! Trial and licence keys, checked entirely offline.
//!
//! A key is `LZ1.<payload>.<signature>`: base64url JSON holding the plan, the store's order reference, the issue
//! date and the expiry, signed with Ed25519. The app holds only the public key below, so it can check a key but
//! never mint one, and it never contacts anyone to do so.
//!
//! The only file this writes, `licence.json` in the app's data folder, holds two things: the date of first launch
//! (for the 90-day trial) and the key, if one was entered. Nothing about the person who bought it.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const PUBLIC_KEY_HEX: &str = "a90c833f8f591be1131571bec9defb629c5a3ad2e7eec4e50f025fae2faa889e";
pub const TRIAL_DAYS: i64 = 90;
/// One gentle reminder shows from this many days before the trial ends.
pub const REMIND_DAYS: i64 = 15;
const DAY_MS: i64 = 86_400_000;
const PLANS: &[&str] = &["monthly", "pro", "lifetime"];
/// Lifetime keys cover one major version (every update within it). 0.x releases count as version 1.
pub const APP_MAJOR: u32 = 1;

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct Claims {
    pub v: u32,
    pub plan: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub iss: String,
    pub exp: Option<String>,
    /// Lifetime only: the major version this key covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major: Option<u32>,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct Stored {
    pub first_run_ms: i64,
    pub key: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Status {
    /// trial, licensed, trial_over or expired
    pub state: &'static str,
    pub trial_days_left: i64,
    pub plan: Option<String>,
    pub expires: Option<String>,
    pub reference: Option<String>,
    pub remind: bool,
}

impl Status {
    pub fn allowed(&self) -> bool {
        matches!(self.state, "trial" | "licensed")
    }
}

fn public_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = u8::from_str_radix(&PUBLIC_KEY_HEX[i * 2..i * 2 + 2], 16).expect("valid hex");
    }
    k
}

pub fn verify_with(key: &str, pk: &[u8; 32]) -> Result<Claims, String> {
    let compact: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let rest = compact.strip_prefix("LZ1.").ok_or("That isn't a LocatorZero licence key. Keys start with LZ1.")?;
    let (body, sig) = rest.split_once('.').ok_or("The key looks cut short. Copy it again from your email.")?;
    let sig: [u8; 64] = B64
        .decode(sig)
        .ok()
        .and_then(|s| s.try_into().ok())
        .ok_or("The key looks cut short. Copy it again from your email.")?;
    let vk = VerifyingKey::from_bytes(pk).map_err(|_| "internal: bad public key".to_string())?;
    vk.verify_strict(body.as_bytes(), &Signature::from_bytes(&sig))
        .map_err(|_| "This key wasn't issued by LocatorZero, or a character changed. Copy it again.".to_string())?;
    let claims: Claims =
        B64.decode(body).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or("The key's contents can't be read.")?;
    if claims.v != 1 || !PLANS.contains(&claims.plan.as_str()) {
        return Err("This key is for a newer version of LocatorZero. Please update the app.".into());
    }
    Ok(claims)
}

pub fn verify(key: &str) -> Result<Claims, String> {
    verify_with(key, &public_key())
}

/// Days since 1970-01-01 for a YYYY-MM-DD date (Howard Hinnant's civil-days algorithm).
fn date_ms(d: &str) -> Option<i64> {
    let mut it = d.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (it.next()??, it.next()??, it.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) * DAY_MS)
}

pub fn status_at(stored: &Stored, now_ms: i64, pk: &[u8; 32]) -> Status {
    // A clock set back before first launch counts as day zero, not as extra trial.
    let used_days = ((now_ms - stored.first_run_ms).max(0)) / DAY_MS;
    let trial_days_left = (TRIAL_DAYS - used_days).max(0);
    let mut expired_claims = None;
    if let Some(Ok(c)) = stored.key.as_deref().map(|k| verify_with(k, pk)) {
        let version_ok = c.plan != "lifetime" || c.major.unwrap_or(APP_MAJOR) >= APP_MAJOR;
        let valid = version_ok && match c.exp.as_deref() {
            None => true,
            Some(e) => date_ms(e).map(|t| now_ms < t + DAY_MS).unwrap_or(false),
        };
        if valid {
            return Status {
                state: "licensed",
                trial_days_left,
                plan: Some(c.plan),
                expires: c.exp,
                reference: Some(c.reference),
                remind: false,
            };
        }
        expired_claims = Some(c);
    }
    if trial_days_left > 0 {
        return Status {
            state: "trial",
            trial_days_left,
            plan: None,
            expires: None,
            reference: None,
            remind: trial_days_left <= REMIND_DAYS,
        };
    }
    match expired_claims {
        Some(c) => Status { state: "expired", trial_days_left: 0, plan: Some(c.plan), expires: c.exp, reference: Some(c.reference), remind: false },
        None => Status { state: "trial_over", trial_days_left: 0, plan: None, expires: None, reference: None, remind: false },
    }
}

pub struct Licence {
    path: PathBuf,
}

impl Licence {
    pub fn new(dir: &Path) -> Self {
        Licence { path: dir.join("licence.json") }
    }

    pub fn load(&self) -> Stored {
        if let Some(s) = std::fs::read(&self.path).ok().and_then(|b| serde_json::from_slice::<Stored>(&b).ok()) {
            return s;
        }
        let s = Stored { first_run_ms: crate::sources::now_ms(), key: None };
        let _ = self.save(&s);
        s
    }

    fn save(&self, s: &Stored) -> Result<(), String> {
        if let Some(d) = self.path.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.path, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())
    }

    pub fn status(&self) -> Status {
        status_at(&self.load(), crate::sources::now_ms(), &public_key())
    }

    pub fn activate(&self, key: &str) -> Result<Status, String> {
        verify(key)?;
        let mut s = self.load();
        s.key = Some(key.chars().filter(|c| !c.is_whitespace()).collect());
        self.save(&s)?;
        let st = self.status();
        if st.state == "expired" {
            return Err("This key has expired. The renewal email has a fresh one.".into());
        }
        Ok(st)
    }

    pub fn remove(&self) -> Result<Status, String> {
        let mut s = self.load();
        s.key = None;
        self.save(&s)?;
        Ok(self.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const NOW: i64 = 1_791_417_600_000; // 2026-10-08

    fn kp() -> (SigningKey, [u8; 32]) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk = sk.verifying_key().to_bytes();
        (sk, pk)
    }

    fn issue(sk: &SigningKey, plan: &str, exp: Option<&str>) -> String {
        let claims = Claims { v: 1, plan: plan.into(), reference: "ORDER-1".into(), iss: "2026-10-01".into(), exp: exp.map(Into::into), major: (plan == "lifetime").then_some(APP_MAJOR) };
        let body = B64.encode(serde_json::to_vec(&claims).unwrap());
        let sig = sk.sign(body.as_bytes());
        format!("LZ1.{body}.{}", B64.encode(sig.to_bytes()))
    }

    #[test]
    fn dates_convert() {
        assert_eq!(date_ms("1970-01-01"), Some(0));
        assert_eq!(date_ms("2026-10-08"), Some(NOW));
        assert_eq!(date_ms("2026-13-01"), None);
    }

    #[test]
    fn trial_counts_down_and_reminds_once_near_the_end() {
        let (_, pk) = kp();
        let s = Stored { first_run_ms: NOW, key: None };
        let st = status_at(&s, NOW, &pk);
        assert_eq!((st.state, st.trial_days_left, st.remind), ("trial", 90, false));
        let st = status_at(&s, NOW + 80 * DAY_MS, &pk);
        assert_eq!((st.state, st.trial_days_left, st.remind), ("trial", 10, true));
        let st = status_at(&s, NOW + 90 * DAY_MS, &pk);
        assert_eq!(st.state, "trial_over");
        assert!(!st.allowed());
        // setting the clock back does not add trial days
        assert_eq!(status_at(&s, NOW - 400 * DAY_MS, &pk).trial_days_left, 90);
    }

    #[test]
    fn valid_keys_unlock_and_expire_on_time() {
        let (sk, pk) = kp();
        let life = Stored { first_run_ms: NOW - 200 * DAY_MS, key: Some(issue(&sk, "lifetime", None)) };
        let st = status_at(&life, NOW, &pk);
        assert_eq!((st.state, st.plan.as_deref()), ("licensed", Some("lifetime")));
        let monthly = Stored { first_run_ms: NOW - 200 * DAY_MS, key: Some(issue(&sk, "monthly", Some("2026-11-08"))) };
        assert_eq!(status_at(&monthly, NOW, &pk).state, "licensed");
        assert_eq!(status_at(&monthly, NOW + 31 * DAY_MS, &pk).state, "licensed"); // through the expiry day
        assert_eq!(status_at(&monthly, NOW + 32 * DAY_MS, &pk).state, "expired");
    }

    #[test]
    fn lifetime_covers_its_own_major_version_only() {
        let (sk, pk) = kp();
        let mut c = Claims { v: 1, plan: "lifetime".into(), reference: "R".into(), iss: "2026-10-01".into(), exp: None, major: Some(APP_MAJOR - 1) };
        let sign = |c: &Claims| {
            let body = B64.encode(serde_json::to_vec(c).unwrap());
            format!("LZ1.{body}.{}", B64.encode(sk.sign(body.as_bytes()).to_bytes()))
        };
        let old = Stored { first_run_ms: NOW - 200 * DAY_MS, key: Some(sign(&c)) };
        assert_eq!(status_at(&old, NOW, &pk).state, "expired", "a key for an earlier major version must not unlock this one");
        c.major = Some(APP_MAJOR);
        let current = Stored { first_run_ms: NOW - 200 * DAY_MS, key: Some(sign(&c)) };
        assert_eq!(status_at(&current, NOW, &pk).state, "licensed");
    }

    #[test]
    fn tampered_or_foreign_keys_are_refused() {
        let (sk, pk) = kp();
        let good = issue(&sk, "pro", Some("2027-10-22"));
        assert!(verify_with(&good, &pk).is_ok());
        // change "pro" to "lifetime" in the payload without re-signing
        let (_, rest) = good.split_once('.').unwrap();
        let (body, sig) = rest.split_once('.').unwrap();
        let mut c: Claims = serde_json::from_slice(&B64.decode(body).unwrap()).unwrap();
        c.plan = "lifetime".into();
        c.exp = None;
        let forged = format!("LZ1.{}.{sig}", B64.encode(serde_json::to_vec(&c).unwrap()));
        assert!(verify_with(&forged, &pk).is_err());
        // signed by someone else
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(verify_with(&issue(&other, "lifetime", None), &pk).is_err());
        assert!(verify_with("hello", &pk).is_err());
        // whitespace from an email line-wrap is fine
        let wrapped = format!("{}\n  {}", &good[..20], &good[20..]);
        assert!(verify_with(&wrapped, &pk).is_ok());
    }

    #[test]
    fn stored_file_holds_only_first_run_and_key() {
        let d = tempfile::tempdir().unwrap();
        let l = Licence::new(d.path());
        assert_eq!(l.status().state, "trial");
        assert!(l.activate("LZ1.bad.key").is_err());
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(d.path().join("licence.json")).unwrap()).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["first_run_ms", "key"]);
    }
}
