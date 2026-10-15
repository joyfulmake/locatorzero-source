//! File locations. Preferred path: ask the operating system's own index (plocate on Linux, Spotlight on macOS,
//! Windows Search on Windows) and mirror nothing. Fallback: a volatile in-memory walk of the home folder, labelled degraded.

use super::{home, mtime_ms, now_ms, SourceStatus};
use crate::hit::Hit;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

const LABEL: &str = "This computer";

enum Backend {
    Locate { bin: &'static str, all_flag: bool, db: Option<PathBuf> },
    Spotlight,
    #[cfg_attr(not(windows), allow(dead_code))]
    WindowsSearch,
    Walk,
}

fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
        .unwrap_or(false)
}

fn backend() -> Backend {
    if cfg!(target_os = "macos") && on_path("mdfind") {
        return Backend::Spotlight;
    }
    #[cfg(windows)]
    if winsearch::available() {
        return Backend::WindowsSearch;
    }
    if cfg!(unix) {
        for (bin, all_flag, db) in [
            ("plocate", false, "/var/lib/plocate/plocate.db"),
            ("locate", true, "/var/lib/mlocate/mlocate.db"),
        ] {
            if on_path(bin) {
                let db = Path::new(db);
                return Backend::Locate { bin, all_flag, db: db.exists().then(|| db.to_path_buf()) };
            }
        }
    }
    Backend::Walk
}

pub fn status() -> SourceStatus {
    match backend() {
        Backend::Locate { bin, db, .. } => {
            let age = db.as_ref().and_then(|d| std::fs::metadata(d).ok()).and_then(|m| mtime_ms(&m)).map(|t| now_ms() - t);
            let stale = age.map(|a| a > 36 * 3600 * 1000).unwrap_or(true);
            SourceStatus {
                id: "files",
                label: "Files on this computer",
                available: true,
                mode: format!("system index ({bin})"),
                age_ms: age,
                degraded: stale,
                note: if stale {
                    "The system index looks old, so very new files may be missing. It refreshes on the system's own schedule.".into()
                } else {
                    "Read from the index your system already keeps. LocatorZero keeps no index of its own.".into()
                },
            }
        }
        Backend::Spotlight => SourceStatus {
            id: "files",
            label: "Files on this computer",
            available: true,
            mode: "system index (Spotlight)".into(),
            age_ms: None,
            degraded: false,
            note: "Folders Spotlight is told to skip are not searched.".into(),
        },
        Backend::WindowsSearch => SourceStatus {
            id: "files",
            label: "Files on this computer",
            available: true,
            mode: "system index (Windows Search)".into(),
            age_ms: None,
            degraded: false,
            note: "Only locations Windows indexes are searched, usually your user folders. Add more in Windows' Indexing Options.".into(),
        },
        Backend::Walk => {
            let (count, done) = walk_progress();
            SourceStatus {
                id: "files",
                label: "Files on this computer",
                available: true,
                mode: "walking your home folder, in memory".into(),
                age_ms: None,
                degraded: true,
                note: format!(
                    "No system index found, so LocatorZero lists your home folder into memory ({count} so far{}). It is dropped when the app closes.",
                    if done { ", complete" } else { ", still going" }
                ),
            }
        }
    }
}

pub fn search(toks: &[String], limit: usize) -> Result<Vec<Hit>, String> {
    let paths = match backend() {
        Backend::Locate { bin, all_flag, .. } => {
            // Names first: people usually type part of a file name, and matching on names alone keeps common words
            // ("kali", "cache") from returning half the disk. Whole-path matching fills in only when names run short.
            let locate = |basename: bool, n: usize| {
                let mut cmd = Command::new(bin);
                cmd.args(["-i", "-l", &n.to_string()]);
                if basename {
                    cmd.arg("-b");
                }
                if all_flag {
                    cmd.arg("-A");
                }
                cmd.arg("--").args(toks);
                run_lines(cmd)
            };
            let mut paths = locate(true, limit)?;
            if paths.len() < 40 {
                let more = locate(false, limit)?;
                let seen: std::collections::HashSet<String> = paths.iter().cloned().collect();
                paths.extend(more.into_iter().filter(|p| !seen.contains(p)));
            }
            paths
        }
        Backend::Spotlight => {
            let mut cmd = Command::new("mdfind");
            cmd.args(["-name", &toks[0]]);
            run_lines(cmd)?
        }
        #[cfg(windows)]
        Backend::WindowsSearch => winsearch::query(toks, limit * 4)?,
        #[cfg(not(windows))]
        Backend::WindowsSearch => unreachable!(),
        Backend::Walk => walk_search(toks, limit * 4),
    };
    Ok(rank(paths, toks, limit))
}

fn run_lines(mut cmd: Command) -> Result<Vec<String>, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    // locate exits 1 when nothing matched, which is not an error for us
    if !out.status.success() && !out.stdout.is_empty() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::to_owned).collect())
}

fn name_of(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

/// Every token must appear in the path. Names that hold all tokens first, then fewer hidden segments, then shorter.
pub fn order(paths: Vec<String>, toks: &[String], limit: usize) -> Vec<String> {
    let mut v: Vec<(u8, usize, usize, String)> = paths
        .into_iter()
        .filter_map(|p| {
            let lp = p.to_lowercase();
            if !toks.iter().all(|t| lp.contains(t.as_str())) {
                return None;
            }
            let ln = name_of(&lp).to_string();
            let in_name = if toks.iter().all(|t| ln.contains(t.as_str())) { 0 } else { 1 };
            let hidden = p.split(['/', '\\']).filter(|s| s.starts_with('.') && s.len() > 1).count();
            Some((in_name, hidden, p.len(), p))
        })
        .collect();
    v.sort();
    v.truncate(limit);
    v.into_iter().map(|(_, _, _, p)| p).collect()
}

/// The system index can lag: a file deleted since its last refresh is still listed there. Every result is checked
/// against the disk, and anything that no longer exists is dropped, so a permanently deleted file never shows.
pub fn rank(paths: Vec<String>, toks: &[String], limit: usize) -> Vec<Hit> {
    order(paths, toks, limit)
        .into_iter()
        .filter_map(|p| {
            let meta = std::fs::symlink_metadata(&p).ok()?;
            let is_dir = meta.is_dir();
            Some(Hit {
                n: name_of(&p).to_string(),
                src: LABEL.into(),
                s: "files",
                k: is_dir.then_some("folder"),
                z: meta.is_file().then(|| meta.len()),
                t: mtime_ms(&meta),
                url: None,
                id: None,
                p,
            })
        })
        .collect()
}

// ---- walks: volatile, bounded listings of one place, kept in memory only ----
//
// Used for the home folder when no system index exists, and for drives the index does not cover (USB, external,
// network). Each listing starts only after the user consents to that place, lives in memory, and is dropped by
// `forget()` (wipe, idle timeout) or when the app closes.

struct Walk {
    paths: Vec<String>,
    done: bool,
    cancelled: bool,
}
type Shared = std::sync::Arc<Mutex<Walk>>;
static WALKS: OnceLock<Mutex<std::collections::HashMap<PathBuf, Shared>>> = OnceLock::new();
const WALK_CAP: usize = 1_000_000;

fn walks() -> &'static Mutex<std::collections::HashMap<PathBuf, Shared>> {
    WALKS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn walk_of(root: &Path) -> Shared {
    let mut map = walks().lock().unwrap();
    if let Some(w) = map.get(root) {
        return w.clone();
    }
    let w: Shared = std::sync::Arc::new(Mutex::new(Walk { paths: Vec::new(), done: false, cancelled: false }));
    map.insert(root.to_path_buf(), w.clone());
    let (state, root) = (w.clone(), root.to_path_buf());
    std::thread::spawn(move || {
        let mut stack = vec![root];
        let mut batch = Vec::with_capacity(4096);
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let name = e.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.') || name == "node_modules" || name == "AppData" || name == "$RECYCLE.BIN" || name == "System Volume Information" {
                    continue;
                }
                // Do not follow links: a link can point back up the tree or off this drive.
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(e.path());
                }
                batch.push(e.path().to_string_lossy().into_owned());
            }
            if batch.len() >= 4096 {
                let mut w = state.lock().unwrap();
                if w.cancelled {
                    return;
                }
                w.paths.append(&mut batch);
                if w.paths.len() >= WALK_CAP {
                    break;
                }
            }
        }
        let mut w = state.lock().unwrap();
        w.paths.append(&mut batch);
        w.done = true;
    });
    w
}

fn walk_progress() -> (usize, bool) {
    let Some(h) = home() else { return (0, true) };
    let w = walk_of(&h);
    let w = w.lock().unwrap();
    (w.paths.len(), w.done)
}

fn walk_root_search(root: &Path, toks: &[String], cap: usize) -> Vec<String> {
    let w = walk_of(root);
    let w = w.lock().unwrap();
    w.paths
        .iter()
        .filter(|p| {
            let lp = p.to_lowercase();
            toks.iter().all(|t| lp.contains(t.as_str()))
        })
        .take(cap)
        .cloned()
        .collect()
}

fn walk_search(toks: &[String], cap: usize) -> Vec<String> {
    match home() {
        Some(h) => walk_root_search(&h, toks, cap),
        None => vec![],
    }
}

/// Progress of the listing for one place: (items so far, finished).
pub fn place_progress(root: &Path) -> (usize, bool) {
    let map = walks().lock().unwrap();
    map.get(root).map(|w| {
        let w = w.lock().unwrap();
        (w.paths.len(), w.done)
    }).unwrap_or((0, false))
}

/// Drop every in-memory listing (wipe, idle timeout).
pub fn forget() {
    let mut map = walks().lock().unwrap();
    for w in map.values() {
        let mut w = w.lock().unwrap();
        w.cancelled = true;
        w.paths = Vec::new();
    }
    map.clear();
}

/// Search one place the user chose. Places the system index covers are asked through it; others are listed into
/// memory (after consent, which the interface asks for before calling this).
pub fn search_in(toks: &[String], limit: usize, root: &Path, indexed: bool) -> Result<Vec<Hit>, String> {
    if !root.is_dir() {
        return Err("that place is no longer connected".into());
    }
    let prefix = root.to_string_lossy().into_owned();
    let inside = |p: &String| p.starts_with(&prefix);
    let paths = match (indexed, backend()) {
        (true, Backend::Locate { bin, all_flag, .. }) => {
            let mut cmd = Command::new(bin);
            cmd.args(["-i", "-l", &(limit * 4).to_string()]);
            if all_flag {
                cmd.arg("-A");
            }
            cmd.arg("--").args(toks).arg(&prefix);
            run_lines(cmd)?.into_iter().filter(inside).collect()
        }
        (true, Backend::Spotlight) => {
            let mut cmd = Command::new("mdfind");
            cmd.args(["-onlyin", &prefix, "-name", &toks[0]]);
            run_lines(cmd)?
        }
        _ => walk_root_search(root, toks, limit * 4),
    };
    Ok(rank(paths, toks, limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rank_prefers_name_matches_and_requires_every_token() {
        let toks = vec!["budget".to_string(), "2026".to_string()];
        let paths = vec![
            "/home/a/budget/2026/notes.txt".to_string(),
            "/home/a/docs/Budget_2026.xlsx".to_string(),
            "/home/a/.cache/budget-2026.tmp".to_string(),
            "/home/a/docs/unrelated.txt".to_string(),
        ];
        let names: Vec<_> = order(paths, &toks, 10).into_iter().map(|p| name_of(&p).to_string()).collect();
        assert_eq!(names, ["Budget_2026.xlsx", "budget-2026.tmp", "notes.txt"]);
    }

    #[test]
    fn a_chosen_drive_is_listed_into_memory_searched_and_forgotten() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("Photos/2024")).unwrap();
        std::fs::write(d.path().join("Photos/2024/beach-trip.jpg"), "x").unwrap();
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();
        std::fs::create_dir_all(d.path().join(".hidden")).unwrap();
        std::fs::write(d.path().join(".hidden/beach-secret.txt"), "x").unwrap();
        let toks = vec!["beach".to_string()];
        let mut hits = vec![];
        for _ in 0..50 {
            hits = search_in(&toks, 50, d.path(), false).unwrap();
            if place_progress(d.path()).1 { hits = search_in(&toks, 50, d.path(), false).unwrap(); break; }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let names: Vec<_> = hits.iter().map(|h| h.n.as_str()).collect();
        assert_eq!(names, ["beach-trip.jpg"], "hidden folders are skipped");
        forget();
        assert_eq!(place_progress(d.path()), (0, false), "forget drops the listing");
    }

    #[test]
    fn deleted_files_never_show_even_if_the_index_still_lists_them() {
        let d = tempfile::tempdir().unwrap();
        let keep = d.path().join("report-keep.txt");
        let gone = d.path().join("report-gone.txt");
        std::fs::write(&keep, "x").unwrap();
        std::fs::write(&gone, "x").unwrap();
        std::fs::remove_file(&gone).unwrap(); // as if permanently deleted after the index last refreshed
        let stale_index = vec![keep.to_string_lossy().into_owned(), gone.to_string_lossy().into_owned()];
        let hits = rank(stale_index, &["report".to_string()], 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].n, "report-keep.txt");
    }

    #[test]
    fn locate_backend_finds_a_real_file_when_available() {
        if !matches!(backend(), Backend::Locate { .. }) {
            return;
        }
        // /etc/hostname is in practically every locate database
        let hits = search(&["hostname".to_string()], 50).unwrap();
        assert!(hits.iter().any(|h| h.p == "/etc/hostname"), "{hits:?}");
    }
}

/// Windows Search, through one long-lived PowerShell that holds an OLE DB connection to the local index
/// (Search.CollatorDSO). It answers one SQL query per line on stdin. Nothing leaves the machine: the provider is the
/// Windows Search service on this computer.
#[cfg(windows)]
mod winsearch {
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
    use std::sync::{Mutex, OnceLock};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
  $c = New-Object -ComObject ADODB.Connection
  $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  [Console]::Out.WriteLine('READY')
} catch { [Console]::Out.WriteLine('FAIL ' + $_.Exception.Message); exit 1 }
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $rs = New-Object -ComObject ADODB.Recordset
    $rs.Open($line, $c)
    while (-not $rs.EOF) { [Console]::Out.WriteLine([string]$rs.Fields.Item('System.ItemPathDisplay').Value); $rs.MoveNext() }
    $rs.Close()
  } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }
  [Console]::Out.WriteLine('<<END>>'); [Console]::Out.Flush()
}
"#;

    struct Session {
        _child: Child,
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
    }

    static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

    fn start() -> Option<Session> {
        let mut child = Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdin = child.stdin.take()?;
        let mut stdout = BufReader::new(child.stdout.take()?);
        let mut first = String::new();
        stdout.read_line(&mut first).ok()?;
        if first.trim() != "READY" {
            let _ = child.kill();
            return None;
        }
        Some(Session { _child: child, stdin, stdout })
    }

    fn session() -> &'static Mutex<Option<Session>> {
        SESSION.get_or_init(|| Mutex::new(start()))
    }

    pub fn available() -> bool {
        session().lock().map(|s| s.is_some()).unwrap_or(false)
    }

    /// One token as a LIKE pattern: quotes doubled, and %, _ and [ bracketed so they match literally.
    pub(super) fn like(t: &str) -> String {
        let mut s = String::from("%");
        for c in t.chars().filter(|c| !c.is_control()) {
            match c {
                '\'' => s.push_str("''"),
                '%' | '_' | '[' => {
                    s.push('[');
                    s.push(c);
                    s.push(']');
                }
                _ => s.push(c),
            }
        }
        s.push('%');
        s
    }

    pub(super) fn sql(toks: &[String], limit: usize) -> String {
        let conds: Vec<String> = toks
            .iter()
            .map(|t| {
                let p = like(t);
                format!("(System.ItemNameDisplay LIKE '{p}' OR System.ItemFolderPathDisplay LIKE '{p}')")
            })
            .collect();
        format!(
            "SELECT TOP {limit} System.ItemPathDisplay FROM SYSTEMINDEX WHERE SCOPE='file:' AND {}",
            conds.join(" AND ")
        )
    }

    pub fn query(toks: &[String], limit: usize) -> Result<Vec<String>, String> {
        let mut guard = session().lock().map_err(|_| "Windows Search session poisoned".to_string())?;
        let s = guard.as_mut().ok_or("Windows Search is not available")?;
        let q = sql(toks, limit);
        if writeln!(s.stdin, "{q}").and_then(|_| s.stdin.flush()).is_err() {
            *guard = None;
            return Err("Windows Search session ended".into());
        }
        let mut out = Vec::new();
        loop {
            let mut line = String::new();
            match s.stdout.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    *guard = None;
                    return Err("Windows Search session ended".into());
                }
                Ok(_) => {}
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line == "<<END>>" {
                break;
            }
            if let Some(e) = line.strip_prefix("ERR ") {
                return Err(e.to_string());
            }
            if !line.is_empty() {
                out.push(line.to_string());
            }
        }
        Ok(out)
    }
}
