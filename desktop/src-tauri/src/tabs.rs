//! Open tabs, through the LocatorZero Tabs extension (ADR-0019 preferred path).
//!
//! The browser starts this binary as a native-messaging host. The host keeps the extension's latest tab list in
//! memory and answers the LocatorZero window over a Unix socket inside a 0700 directory, so only this user can
//! connect. Nothing is written to disk except the socket itself, which is removed when the browser closes.
//! This is local inter-process communication: no network address is ever opened.

use crate::hit::Hit;
use crate::sources::SourceStatus;
use serde::Deserialize;
use std::path::PathBuf;

pub const HOST_NAME: &str = "dev.locatorzero.tabs";
pub const CHROMIUM_EXTENSION_ID: &str = "lkodnhoihmagdbkmcicjjjgfipmfphio";
pub const FIREFOX_EXTENSION_ID: &str = "tabs@locatorzero.dev";

#[derive(Deserialize, Debug, Clone)]
pub struct Tab {
    #[serde(default)]
    pub w: i64,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub last: i64,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Snapshot {
    pub browser: String,
    pub tabs: Vec<Tab>,
}

/// True when the browser launched us as a native-messaging host rather than the user launching the app.
pub fn launched_as_host(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a.starts_with("chrome-extension://") || a == FIREFOX_EXTENSION_ID)
}

#[cfg(unix)]
fn socket_dir() -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc_getuid() };
    base.join(format!("locatorzero-{uid}"))
}

#[cfg(unix)]
extern "C" {
    #[link_name = "getuid"]
    fn libc_getuid() -> u32;
}

pub fn filter(snaps: &[Snapshot], toks: &[String], limit: usize) -> Vec<Hit> {
    let mut out = Vec::new();
    for s in snaps {
        for t in &s.tabs {
            if !(t.url.starts_with("http://") || t.url.starts_with("https://") || t.url.starts_with("file://")) {
                continue;
            }
            let hay = format!("{} {}", t.title, t.url).to_lowercase();
            if !toks.iter().all(|k| hay.contains(k.as_str())) {
                continue;
            }
            let host = t.url.split_once("://").map(|(_, r)| r).unwrap_or(&t.url).split(['/', '?', '#']).next().unwrap_or("").to_string();
            out.push(Hit {
                n: if t.title.trim().is_empty() { t.url.clone() } else { t.title.clone() },
                p: format!("{}/Window {}/{}", s.browser, t.w, if host.is_empty() { "files" } else { &host }),
                s: "tabs",
                src: "Open tabs".into(),
                k: Some("web"),
                z: None,
                t: (t.last > 0).then_some(t.last),
                url: Some(t.url.clone()),
                id: None,
            });
        }
    }
    out.sort_by_key(|h| -h.t.unwrap_or(0));
    out.truncate(limit);
    out
}

#[cfg(unix)]
mod imp {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn read_message(r: &mut impl Read) -> Option<Vec<u8>> {
        let mut len = [0u8; 4];
        r.read_exact(&mut len).ok()?;
        let n = u32::from_ne_bytes(len) as usize;
        if n > 64 * 1024 * 1024 {
            return None;
        }
        let mut buf = vec![0u8; n];
        r.read_exact(&mut buf).ok()?;
        Some(buf)
    }

    /// Native-messaging host: lives as long as the browser keeps the pipe open.
    pub fn run_host() {
        let dir = socket_dir();
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        let path = dir.join(format!("tabs-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let Ok(listener) = UnixListener::bind(&path) else { return };
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        let latest: Arc<Mutex<Option<Vec<u8>>>> = Arc::new(Mutex::new(None));

        let serve = latest.clone();
        std::thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let _ = conn.set_read_timeout(Some(Duration::from_millis(500)));
                let mut conn = conn;
                let mut line = String::new();
                if BufReader::new(&conn).read_line(&mut line).is_ok() && line.trim() == "list" {
                    let snap = serve.lock().unwrap().clone().unwrap_or_else(|| b"null".to_vec());
                    let _ = conn.write_all(&snap);
                    let _ = conn.write_all(b"\n");
                }
            }
        });

        let mut stdin = std::io::stdin().lock();
        while let Some(msg) = read_message(&mut stdin) {
            // Keep only well-formed snapshots; anything else is ignored.
            if serde_json::from_slice::<Snapshot>(&msg).is_ok() {
                *latest.lock().unwrap() = Some(msg);
            }
        }
        let _ = std::fs::remove_file(&path);
    }

    pub fn snapshots() -> Vec<Snapshot> {
        let Ok(rd) = std::fs::read_dir(socket_dir()) else { return vec![] };
        let mut out = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x != "sock").unwrap_or(true) {
                continue;
            }
            let mut s = match UnixStream::connect(&p) {
                Ok(s) => s,
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
                    // A host that died without cleaning up; the directory is ours, so tidy it.
                    let _ = std::fs::remove_file(&p);
                    continue;
                }
                Err(_) => continue,
            };
            let _ = s.set_read_timeout(Some(Duration::from_millis(400)));
            if s.write_all(b"list\n").is_err() {
                continue;
            }
            let mut line = String::new();
            if BufReader::new(&s).read_line(&mut line).is_ok() {
                if let Ok(snap) = serde_json::from_str::<Snapshot>(line.trim()) {
                    out.push(snap);
                }
            }
        }
        out
    }
}

#[cfg(unix)]
pub use imp::{run_host, snapshots};

#[cfg(not(unix))]
pub fn run_host() {}
#[cfg(not(unix))]
pub fn snapshots() -> Vec<Snapshot> {
    vec![]
}

pub fn search(toks: &[String], limit: usize) -> Vec<Hit> {
    filter(&snapshots(), toks, limit)
}

pub fn status() -> SourceStatus {
    let snaps = snapshots();
    let mut names: Vec<String> = snaps.iter().map(|s| s.browser.clone()).collect();
    names.sort();
    names.dedup();
    SourceStatus {
        id: "tabs",
        label: "Open tabs",
        available: cfg!(unix),
        mode: if !cfg!(unix) {
            "not yet available on Windows".into()
        } else if names.is_empty() {
            "needs the LocatorZero Tabs extension".into()
        } else {
            format!("live from {}", names.join(", "))
        },
        age_ms: None,
        degraded: false,
        note: "Press “Set up open tabs”, then add the extension. Tabs in private windows are never shared.".into(),
    }
}

// ---- setup: register the host with installed browsers ----

fn host_targets() -> Vec<(&'static str, PathBuf, bool)> {
    let Some(h) = crate::sources::home() else { return vec![] };
    let mut v: Vec<(&'static str, PathBuf, bool)> = Vec::new();
    if cfg!(target_os = "macos") {
        let a = h.join("Library/Application Support");
        for (n, d) in [("Chrome", "Google/Chrome"), ("Chromium", "Chromium"), ("Brave", "BraveSoftware/Brave-Browser"), ("Edge", "Microsoft Edge"), ("Vivaldi", "Vivaldi")] {
            v.push((n, a.join(d), false));
        }
        v.push(("Firefox", a.join("Mozilla"), true));
    } else {
        let c = h.join(".config");
        for (n, d) in [("Chrome", "google-chrome"), ("Chromium", "chromium"), ("Brave", "BraveSoftware/Brave-Browser"), ("Edge", "microsoft-edge"), ("Vivaldi", "vivaldi")] {
            v.push((n, c.join(d), false));
        }
        v.push(("Firefox", h.join(".mozilla"), true));
    }
    v
}

/// The path browsers should launch. Inside an AppImage the running path is temporary, so use the image itself.
fn host_executable() -> Result<PathBuf, String> {
    if let Some(a) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(a));
    }
    std::env::current_exe().map_err(|e| e.to_string())
}

pub fn manifest_json(exe: &str, firefox: bool) -> String {
    let allowed = if firefox {
        format!("\"allowed_extensions\": [\"{FIREFOX_EXTENSION_ID}\"]")
    } else {
        format!("\"allowed_origins\": [\"chrome-extension://{CHROMIUM_EXTENSION_ID}/\"]")
    };
    format!(
        "{{\n  \"name\": \"{HOST_NAME}\",\n  \"description\": \"LocatorZero open tabs (local only)\",\n  \"path\": {},\n  \"type\": \"stdio\",\n  {allowed}\n}}\n",
        serde_json::to_string(exe).unwrap()
    )
}

/// Writes one small manifest per installed browser. This is the only file LocatorZero ever writes, and only when
/// the user presses the setup button.
pub fn install() -> Result<Vec<String>, String> {
    if cfg!(windows) {
        return Err("Open tabs are not yet available on Windows.".into());
    }
    let exe = host_executable()?;
    let exe = exe.to_string_lossy().into_owned();
    let mut done = Vec::new();
    for (name, root, firefox) in host_targets() {
        if !root.is_dir() {
            continue;
        }
        let dir = root.join(if firefox { "native-messaging-hosts" } else { "NativeMessagingHosts" });
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{HOST_NAME}.json")), manifest_json(&exe, firefox)).map_err(|e| e.to_string())?;
        done.push(name.to_string());
    }
    if done.is_empty() {
        return Err("No supported browser was found.".into());
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap() -> Vec<Snapshot> {
        serde_json::from_str(
            r#"[{"browser":"Chrome","tabs":[
                {"w":1,"url":"https://docs.example.com/budget?x=1","title":"Budget 2026","last":2000},
                {"w":2,"url":"chrome://settings","title":"Budget settings","last":3000},
                {"w":1,"url":"https://news.example/","title":"News","last":1000}]}]"#,
        )
        .unwrap()
    }

    #[test]
    fn filters_tabs_and_skips_browser_pages() {
        let hits = filter(&snap(), &["budget".into()], 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].p, "Chrome/Window 1/docs.example.com");
        assert_eq!(hits[0].t, Some(2000));
    }

    #[test]
    fn host_detection_matches_both_browser_families() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(launched_as_host(&s(&["lz", "chrome-extension://abc/"])));
        assert!(launched_as_host(&s(&["lz", "/path/manifest.json", "tabs@locatorzero.dev"])));
        assert!(!launched_as_host(&s(&["lz"])));
    }

    #[test]
    fn manifest_is_valid_json_with_the_right_origin() {
        let v: serde_json::Value = serde_json::from_str(&manifest_json("/usr/bin/locator \"zero\"", false)).unwrap();
        assert_eq!(v["path"], "/usr/bin/locator \"zero\"");
        assert_eq!(v["allowed_origins"][0], format!("chrome-extension://{CHROMIUM_EXTENSION_ID}/"));
        let f: serde_json::Value = serde_json::from_str(&manifest_json("/x", true)).unwrap();
        assert_eq!(f["allowed_extensions"][0], FIREFOX_EXTENSION_ID);
    }
}
