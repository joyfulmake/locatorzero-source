//! Browser history, read from each browser's own database, opened read-only and immutable so LocatorZero never
//! takes a lock or writes a journal. While a browser is running its newest visits can sit in a side file that an
//! immutable read does not see, so this source can lag by minutes; the status says so.

use super::{home, now_ms, SourceStatus};
use crate::hit::Hit;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Family {
    Chromium,
    Firefox,
}

#[derive(Debug, Clone)]
pub struct Store {
    pub browser: String,
    pub profile: String,
    pub path: PathBuf,
    pub family: Family,
}

fn chromium_roots(h: &Path) -> Vec<(&'static str, PathBuf)> {
    let mut v = Vec::new();
    if cfg!(target_os = "linux") {
        let c = h.join(".config");
        v.push(("Chrome", c.join("google-chrome")));
        v.push(("Chromium", c.join("chromium")));
        v.push(("Brave", c.join("BraveSoftware/Brave-Browser")));
        v.push(("Edge", c.join("microsoft-edge")));
        v.push(("Vivaldi", c.join("vivaldi")));
    } else if cfg!(target_os = "macos") {
        let a = h.join("Library/Application Support");
        v.push(("Chrome", a.join("Google/Chrome")));
        v.push(("Chromium", a.join("Chromium")));
        v.push(("Brave", a.join("BraveSoftware/Brave-Browser")));
        v.push(("Edge", a.join("Microsoft Edge")));
        v.push(("Vivaldi", a.join("Vivaldi")));
    } else if cfg!(windows) {
        if let Some(l) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            v.push(("Chrome", l.join("Google/Chrome/User Data")));
            v.push(("Chromium", l.join("Chromium/User Data")));
            v.push(("Brave", l.join("BraveSoftware/Brave-Browser/User Data")));
            v.push(("Edge", l.join("Microsoft/Edge/User Data")));
            v.push(("Vivaldi", l.join("Vivaldi/User Data")));
        }
    }
    v
}

fn firefox_root(h: &Path) -> Option<PathBuf> {
    if cfg!(target_os = "linux") {
        Some(h.join(".mozilla/firefox"))
    } else if cfg!(target_os = "macos") {
        Some(h.join("Library/Application Support/Firefox/Profiles"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Mozilla/Firefox/Profiles"))
    } else {
        None
    }
}

pub fn stores() -> Vec<Store> {
    let Some(h) = home() else { return vec![] };
    let mut out = Vec::new();
    for (browser, root) in chromium_roots(&h) {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name != "Default" && !name.starts_with("Profile ") {
                continue;
            }
            let path = e.path().join("History");
            if path.is_file() {
                out.push(Store { browser: browser.into(), profile: name, path, family: Family::Chromium });
            }
        }
    }
    if let Some(root) = firefox_root(&h) {
        if let Ok(rd) = std::fs::read_dir(&root) {
            for e in rd.flatten() {
                let path = e.path().join("places.sqlite");
                if path.is_file() {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let profile = name.split_once('.').map(|(_, p)| p.to_string()).unwrap_or(name);
                    out.push(Store { browser: "Firefox".into(), profile, path, family: Family::Firefox });
                }
            }
        }
    }
    out
}

pub fn status() -> SourceStatus {
    let s = stores();
    let mut names: Vec<String> = s.iter().map(|x| x.browser.clone()).collect();
    names.dedup();
    SourceStatus {
        id: "history",
        label: "Browser history",
        available: !s.is_empty(),
        mode: if s.is_empty() { "no supported browser found".into() } else { format!("read-only from {}", names.join(", ")) },
        age_ms: None,
        degraded: false,
        note: "Private windows keep no history, so they cannot be found. Visits from the last few minutes may not show while a browser is open.".into(),
    }
}

/// A SQLite URI that opens the file read-only and immutable, so no lock, journal or WAL file is created.
fn uri(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('\\', "/");
    if !s.starts_with('/') {
        s.insert(0, '/');
    }
    let mut enc = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '%' => enc.push_str("%25"),
            '?' => enc.push_str("%3F"),
            '#' => enc.push_str("%23"),
            ' ' => enc.push_str("%20"),
            _ => enc.push(c),
        }
    }
    format!("file://{enc}?mode=ro&immutable=1")
}

fn host(url: &str) -> &str {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    rest.split(['/', '?', '#']).next().unwrap_or(rest)
}

fn like_escape(t: &str) -> String {
    let mut s = String::from("%");
    for c in t.chars() {
        if matches!(c, '%' | '_' | '\\') {
            s.push('\\');
        }
        s.push(c);
    }
    s.push('%');
    s
}

pub fn query_store(st: &Store, toks: &[String], limit: usize) -> Result<Vec<Hit>, String> {
    let conn = Connection::open_with_flags(
        uri(&st.path),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    let (table, time_col, to_ms): (&str, &str, fn(i64) -> i64) = match st.family {
        // Chromium counts microseconds from 1601-01-01; Firefox counts microseconds from 1970.
        Family::Chromium => ("urls", "last_visit_time", |t| t / 1000 - 11_644_473_600_000),
        Family::Firefox => ("moz_places", "last_visit_date", |t| t / 1000),
    };
    let conds: Vec<String> = (1..=toks.len())
        .map(|i| format!("(lower(coalesce(title,'')) LIKE ?{i} ESCAPE '\\' OR lower(url) LIKE ?{i} ESCAPE '\\')"))
        .collect();
    let sql = format!(
        "SELECT url, coalesce(title,''), {time_col} FROM {table} WHERE {time_col} IS NOT NULL AND {} ORDER BY {time_col} DESC LIMIT {limit}",
        conds.join(" AND ")
    );
    let params: Vec<String> = toks.iter().map(|t| like_escape(t)).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (url, title, t) = row;
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            continue;
        }
        let h = host(&url).to_string();
        out.push(Hit {
            n: if title.trim().is_empty() { url.clone() } else { title },
            p: format!("{}/{}/{}", st.browser, st.profile, h),
            s: "history",
            src: "Browser history".into(),
            k: Some("web"),
            z: None,
            t: Some(to_ms(t)),
            url: Some(url),
        });
    }
    Ok(out)
}

pub fn search(toks: &[String], limit: usize) -> Result<Vec<Hit>, String> {
    let mut all = Vec::new();
    let mut errs = Vec::new();
    for st in stores() {
        match query_store(&st, toks, limit) {
            Ok(mut v) => all.append(&mut v),
            Err(e) => errs.push(format!("{} {}: {e}", st.browser, st.profile)),
        }
    }
    if all.is_empty() && !errs.is_empty() {
        return Err(errs.join("; "));
    }
    let now = now_ms();
    all.sort_by_key(|h| now - h.t.unwrap_or(0));
    all.truncate(limit);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chromium_db(dir: &Path) -> PathBuf {
        let p = dir.join("History");
        let c = Connection::open(&p).unwrap();
        c.execute_batch(
            "CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER);
             INSERT INTO urls(url,title,last_visit_time) VALUES
               ('https://docs.example.com/budget','Budget 2026 – sheet', 13370000000000000),
               ('https://example.org/100%_real','Percent test', 13370000000000001),
               ('chrome://settings','Budget settings', 13370000000000002),
               ('https://news.example/','Morning news', 13370000000000003);",
        )
        .unwrap();
        p
    }

    #[test]
    fn reads_chromium_history_read_only_and_converts_time() {
        let d = tempfile::tempdir().unwrap();
        let path = chromium_db(d.path());
        let before = std::fs::read(&path).unwrap();
        let st = Store { browser: "Chromium".into(), profile: "Default".into(), path: path.clone(), family: Family::Chromium };
        let hits = query_store(&st, &["budget".into()], 10).unwrap();
        assert_eq!(hits.len(), 1, "chrome:// pages are skipped: {hits:?}");
        assert_eq!(hits[0].p, "Chromium/Default/docs.example.com");
        // 13370000000000000 µs since 1601 is 2024-09-07
        assert_eq!(hits[0].t, Some(1_725_526_400_000));
        assert_eq!(std::fs::read(&path).unwrap(), before, "database bytes changed");
        let files: Vec<_> = std::fs::read_dir(d.path()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(files.len(), 1, "a journal or WAL file was created: {files:?}");
    }

    #[test]
    fn like_wildcards_in_the_query_are_literal() {
        let d = tempfile::tempdir().unwrap();
        let st = Store { browser: "Chromium".into(), profile: "Default".into(), path: chromium_db(d.path()), family: Family::Chromium };
        assert_eq!(query_store(&st, &["100%_".into()], 10).unwrap().len(), 1);
        assert_eq!(query_store(&st, &["%".into()], 10).unwrap().len(), 1);
    }

    #[test]
    fn reads_firefox_history() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("places.sqlite");
        Connection::open(&p)
            .unwrap()
            .execute_batch(
                "CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER);
                 INSERT INTO moz_places(url,title,last_visit_date) VALUES ('https://wiki.example.org/atlas','Project Atlas', 1700000000000000);",
            )
            .unwrap();
        let st = Store { browser: "Firefox".into(), profile: "default".into(), path: p, family: Family::Firefox };
        let hits = query_store(&st, &["atlas".into(), "project".into()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].t, Some(1_700_000_000_000));
    }

    #[test]
    fn uri_escapes_special_characters() {
        assert_eq!(uri(Path::new("/a b/c#d?e%f")), "file:///a%20b/c%23d%3Fe%25f?mode=ro&immutable=1");
    }
}
