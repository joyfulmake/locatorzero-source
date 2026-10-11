//! Clean up: duplicate files and the largest files in one place the user chose.
//!
//! Finding them reads as little as possible:
//! 1. List the place: names, sizes and dates only, nothing opened.
//! 2. Only files whose size matches another file's are opened, and only three 16 KB samples (start, middle, end)
//!    are read, in memory, to group likely copies. Nothing is written or kept.
//! 3. Nothing changes until the user ticks files and confirms. Then each file is compared byte for byte with the
//!    copy being kept, and moved to the system's bin (Recycle Bin, Trash), never deleted outright.
//!
//! Only files from the latest scan can be moved, so the interface cannot ask for any other path.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::hash::{DefaultHasher, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

/// Files smaller than this are not worth comparing for space.
pub const MIN_DUP_SIZE: u64 = 256 * 1024;
const SAMPLE: u64 = 16 * 1024;
const MAX_GROUPS: usize = 500;
const MAX_LARGEST: usize = 50;
const MAX_FILES: usize = 2_000_000;

/// Folders that belong to the system or to apps. Removing files there can break things, so they are never scanned.
const SKIP: &[&str] = &[
    "node_modules", "__pycache__", "AppData", "Library", "Application Data", "Windows", "Program Files", "Program Files (x86)",
    "ProgramData", "$Recycle.Bin", "System Volume Information", "Recovery", "proc", "sys", "dev", "snap", "Trash", "lost+found",
];

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP.iter().any(|s| s.eq_ignore_ascii_case(name))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileRef {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Modified time, milliseconds since 1970.
    pub t: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Group {
    pub size: u64,
    /// Space freed by keeping one copy: size × (copies − 1).
    pub wasted: u64,
    /// Oldest first: the suggested copy to keep.
    pub files: Vec<FileRef>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ScanOut {
    pub root: String,
    pub files: usize,
    pub groups: Vec<Group>,
    pub wasted: u64,
    pub largest: Vec<FileRef>,
    pub ms: f64,
    pub truncated: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct Progress {
    /// 0 idle, 1 listing, 2 comparing, 3 done
    pub phase: u8,
    pub files: usize,
    pub compared: usize,
    pub to_compare: usize,
}

static PHASE: AtomicU8 = AtomicU8::new(0);
static FILES: AtomicUsize = AtomicUsize::new(0);
static COMPARED: AtomicUsize = AtomicUsize::new(0);
static TO_COMPARE: AtomicUsize = AtomicUsize::new(0);
static CANCEL: AtomicBool = AtomicBool::new(false);
/// Paths from the latest scan: the only ones that may be moved to the bin.
static ALLOWED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn allowed() -> &'static Mutex<HashSet<PathBuf>> {
    ALLOWED.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn progress() -> Progress {
    Progress {
        phase: PHASE.load(Ordering::Relaxed),
        files: FILES.load(Ordering::Relaxed),
        compared: COMPARED.load(Ordering::Relaxed),
        to_compare: TO_COMPARE.load(Ordering::Relaxed),
    }
}

/// Stop a running scan and drop the latest results (wipe, idle timeout).
pub fn forget() {
    CANCEL.store(true, Ordering::Relaxed);
    allowed().lock().unwrap().clear();
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn file_ref(p: &Path, m: &std::fs::Metadata) -> FileRef {
    FileRef {
        path: p.to_string_lossy().into_owned(),
        name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size: m.len(),
        t: mtime_ms(m),
    }
}

/// Same file reached twice (a hard link): removing one frees nothing, so it must not count as a copy.
#[cfg(unix)]
fn file_id(m: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((m.dev(), m.ino()))
}
#[cfg(not(unix))]
fn file_id(_: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}

/// A fingerprint from three small samples. Equal fingerprints mean "very likely the same"; the full comparison
/// happens before anything is moved.
fn sample_hash(p: &Path, size: u64) -> Option<u64> {
    let mut f = File::open(p).ok()?;
    let mut h = DefaultHasher::new();
    h.write_u64(size);
    let mut buf = vec![0u8; SAMPLE as usize];
    let offsets: Vec<u64> = if size <= SAMPLE * 3 { vec![0] } else { vec![0, size / 2 - SAMPLE / 2, size - SAMPLE] };
    for off in offsets {
        f.seek(SeekFrom::Start(off)).ok()?;
        let want = if size <= SAMPLE * 3 { size as usize } else { SAMPLE as usize };
        if buf.len() < want {
            buf.resize(want, 0);
        }
        f.read_exact(&mut buf[..want]).ok()?;
        h.write(&buf[..want]);
    }
    Some(h.finish())
}

/// List and compare one place. Blocking; run it off the interface thread.
pub fn scan(root: &Path) -> Result<ScanOut, String> {
    if !root.is_dir() {
        return Err("that folder is no longer there".into());
    }
    let t0 = std::time::Instant::now();
    CANCEL.store(false, Ordering::Relaxed);
    FILES.store(0, Ordering::Relaxed);
    COMPARED.store(0, Ordering::Relaxed);
    TO_COMPARE.store(0, Ordering::Relaxed);
    PHASE.store(1, Ordering::Relaxed);
    let out = scan_inner(root, t0);
    PHASE.store(3, Ordering::Relaxed);
    out
}

fn scan_inner(root: &Path, t0: std::time::Instant) -> Result<ScanOut, String> {
    // 1. List: sizes and dates only. Symbolic links are never followed, so a scan cannot wander outside the place.
    let mut by_size: HashMap<u64, Vec<(PathBuf, std::fs::Metadata)>> = HashMap::new();
    let mut largest: Vec<FileRef> = Vec::new();
    let mut count = 0usize;
    let mut truncated = false;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if CANCEL.load(Ordering::Relaxed) {
            return Err("stopped".into());
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name();
            let name = name.to_string_lossy();
            if ft.is_dir() {
                if !skip_dir(&name) {
                    stack.push(e.path());
                }
                continue;
            }
            if !ft.is_file() || name.starts_with('.') {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };
            count += 1;
            if count % 512 == 0 {
                FILES.store(count, Ordering::Relaxed);
            }
            let size = m.len();
            if largest.len() < MAX_LARGEST || size > largest.last().map(|f| f.size).unwrap_or(0) {
                largest.push(file_ref(&e.path(), &m));
                largest.sort_by(|a, b| b.size.cmp(&a.size));
                largest.truncate(MAX_LARGEST);
            }
            if size >= MIN_DUP_SIZE {
                by_size.entry(size).or_default().push((e.path(), m));
            }
            if count >= MAX_FILES {
                truncated = true;
                break;
            }
        }
        if truncated {
            break;
        }
    }
    FILES.store(count, Ordering::Relaxed);

    // 2. Compare: only files that share a size with another, by three small samples each.
    PHASE.store(2, Ordering::Relaxed);
    let candidates: Vec<(u64, Vec<(PathBuf, std::fs::Metadata)>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    TO_COMPARE.store(candidates.iter().map(|(_, v)| v.len()).sum(), Ordering::Relaxed);
    let mut groups = Vec::new();
    for (size, files) in candidates {
        let mut seen_ids = HashSet::new();
        let mut by_hash: HashMap<u64, Vec<FileRef>> = HashMap::new();
        for (p, m) in files {
            if CANCEL.load(Ordering::Relaxed) {
                return Err("stopped".into());
            }
            COMPARED.fetch_add(1, Ordering::Relaxed);
            if let Some(id) = file_id(&m) {
                if !seen_ids.insert(id) {
                    continue;
                }
            }
            if let Some(h) = sample_hash(&p, size) {
                by_hash.entry(h).or_default().push(file_ref(&p, &m));
            }
        }
        for (_, mut v) in by_hash {
            if v.len() > 1 {
                v.sort_by(|a, b| a.t.cmp(&b.t).then(a.path.len().cmp(&b.path.len())));
                groups.push(Group { size, wasted: size * (v.len() as u64 - 1), files: v });
            }
        }
    }
    groups.sort_by(|a, b| b.wasted.cmp(&a.wasted));
    groups.truncate(MAX_GROUPS);

    let mut ok = allowed().lock().unwrap();
    ok.clear();
    ok.extend(groups.iter().flat_map(|g| g.files.iter().map(|f| PathBuf::from(&f.path))));
    ok.extend(largest.iter().map(|f| PathBuf::from(&f.path)));
    let wasted = groups.iter().map(|g| g.wasted).sum();
    Ok(ScanOut {
        root: root.to_string_lossy().into_owned(),
        files: count,
        groups,
        wasted,
        largest,
        ms: t0.elapsed().as_secs_f64() * 1000.0,
        truncated,
    })
}

/// True only if both files have exactly the same bytes. Reads both in full.
pub fn same_content(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if !ma.is_file() || !mb.is_file() || ma.len() != mb.len() {
        return false;
    }
    let (Ok(mut fa), Ok(mut fb)) = (File::open(a), File::open(b)) else { return false };
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let n = match fa.read(&mut ba) {
            Ok(n) => n,
            Err(_) => return false,
        };
        if n == 0 {
            return true;
        }
        if fb.read_exact(&mut bb[..n]).is_err() || ba[..n] != bb[..n] {
            return false;
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct TrashItem {
    pub path: String,
    /// For a duplicate: the copy being kept. The file is moved only if it still matches it exactly.
    pub keep: Option<String>,
}

#[derive(Serialize, Debug, Default)]
pub struct TrashOut {
    pub moved: Vec<String>,
    pub skipped: Vec<(String, String)>,
    pub freed: u64,
}

/// Move the confirmed files to the system's bin, after the checks above. `to_bin` does the move (the real one is
/// `trash::delete`; tests pass their own).
pub fn trash_with(items: &[TrashItem], to_bin: impl Fn(&Path) -> Result<(), String>) -> TrashOut {
    let mut out = TrashOut::default();
    let going: HashSet<&str> = items.iter().map(|i| i.path.as_str()).collect();
    for it in items {
        let p = Path::new(&it.path);
        let skip = |out: &mut TrashOut, why: &str| out.skipped.push((it.path.clone(), why.to_string()));
        if !allowed().lock().unwrap().contains(p) {
            skip(&mut out, "not part of the latest scan");
            continue;
        }
        let Ok(m) = std::fs::symlink_metadata(p) else {
            skip(&mut out, "no longer there");
            continue;
        };
        if !m.is_file() {
            skip(&mut out, "not a regular file");
            continue;
        }
        if let Some(k) = &it.keep {
            let kp = Path::new(k);
            if k == &it.path || going.contains(k.as_str()) {
                skip(&mut out, "the copy to keep was also chosen, so this one stays");
                continue;
            }
            if !allowed().lock().unwrap().contains(kp) || !same_content(p, kp) {
                skip(&mut out, "no longer an exact copy of the file being kept");
                continue;
            }
        }
        match to_bin(p) {
            Ok(()) => {
                out.freed += m.len();
                out.moved.push(it.path.clone());
                allowed().lock().unwrap().remove(p);
            }
            Err(e) => skip(&mut out, &e),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, bytes: &[u8]) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }
    fn big(seed: u8) -> Vec<u8> {
        (0..(MIN_DUP_SIZE as usize + 70_000)).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect()
    }

    // One test, because scans share the allowed-paths set.
    #[test]
    fn finds_copies_skips_app_folders_and_moves_only_confirmed_exact_copies() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        let a = big(1);
        write(&r.join("Photos/trip.jpg"), &a);
        write(&r.join("Downloads/trip (1).jpg"), &a);
        write(&r.join("Backup/old/trip.jpg"), &a);
        let mut near = a.clone();
        let mid = near.len() / 3; // differs outside the three samples: grouped, but refused at the full check
        near[mid] ^= 0xff;
        write(&r.join("Downloads/almost.jpg"), &near);
        write(&r.join("Docs/report.pdf"), &big(2));
        write(&r.join("AppData/cache/trip.jpg"), &a); // app folder: never scanned
        write(&r.join(".hidden/trip.jpg"), &a); // hidden folder: never scanned
        write(&r.join("small1.txt"), b"same");
        write(&r.join("small2.txt"), b"same"); // below the size limit
        #[cfg(unix)]
        std::os::unix::fs::symlink(r.join("Photos/trip.jpg"), r.join("link.jpg")).unwrap(); // links: never followed

        let s = scan(r).unwrap();
        assert_eq!(s.groups.len(), 1, "{:#?}", s.groups);
        let g = &s.groups[0];
        assert_eq!(g.files.len(), 4, "three copies plus the near-copy");
        assert_eq!(g.wasted, a.len() as u64 * 3);
        assert!(g.files.iter().all(|f| !f.path.contains("AppData") && !f.path.contains(".hidden") && !f.path.ends_with("link.jpg")));
        assert_eq!(s.largest.len(), 7);
        assert_eq!(progress().phase, 3);

        let keep = r.join("Photos/trip.jpg").to_string_lossy().into_owned();
        let item = |p: &str| TrashItem { path: r.join(p).to_string_lossy().into_owned(), keep: Some(keep.clone()) };
        let binned = std::cell::RefCell::new(Vec::new());
        let to_bin = |p: &Path| {
            binned.borrow_mut().push(p.to_path_buf());
            fs::remove_file(p).map_err(|e| e.to_string())
        };
        let out = trash_with(
            &[
                item("Downloads/trip (1).jpg"),
                item("Downloads/almost.jpg"),
                TrashItem { path: r.join("AppData/cache/trip.jpg").to_string_lossy().into_owned(), keep: None },
                TrashItem { path: "/etc/hosts".into(), keep: None },
            ],
            to_bin,
        );
        assert_eq!(out.moved, vec![r.join("Downloads/trip (1).jpg").to_string_lossy().into_owned()]);
        assert_eq!(out.freed, a.len() as u64);
        let reasons: Vec<&str> = out.skipped.iter().map(|s| s.1.as_str()).collect();
        assert_eq!(reasons, ["no longer an exact copy of the file being kept", "not part of the latest scan", "not part of the latest scan"]);
        assert!(r.join("Downloads/almost.jpg").exists() && r.join("Photos/trip.jpg").exists());

        // Choosing every copy keeps the one marked to keep.
        let out = trash_with(&[item("Backup/old/trip.jpg"), TrashItem { path: keep.clone(), keep: Some(r.join("Backup/old/trip.jpg").to_string_lossy().into_owned()) }], |p| fs::remove_file(p).map_err(|e| e.to_string()));
        assert!(out.moved.is_empty(), "{out:?}");
        assert!(r.join("Photos/trip.jpg").exists() && r.join("Backup/old/trip.jpg").exists());

        // A file moved once cannot be asked for again, and forget() empties the allowed set.
        assert_eq!(trash_with(&[item("Downloads/trip (1).jpg")], |_| Ok(())).skipped[0].1, "not part of the latest scan");
        forget();
        assert_eq!(trash_with(&[item("Backup/old/trip.jpg")], |_| Ok(())).skipped[0].1, "not part of the latest scan");
        assert_eq!(binned.borrow().len(), 1);
    }
}
