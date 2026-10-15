//! The Recycle Bin (Windows) or Trash (Linux, macOS): things the user deleted, read live from the bin itself, like
//! browser history. Nothing is copied or kept. Only the signed-in user's own bin is listed: on Windows through the
//! shell's Recycle Bin folder, on Linux through the freedesktop Trash folders for this user id, and the operating
//! system's file permissions keep other accounts' bins out of reach. No administrator rights are asked for.
//!
//! Restore is the only change, and only after the user presses Restore and confirms. It takes items from the latest
//! listing only, puts each back exactly where it was, and never overwrites: if something with the same name is there
//! now, it stops and says so.

use crate::hit::Hit;

pub fn bin_label() -> &'static str {
    if cfg!(windows) {
        "Recycle Bin"
    } else {
        "Trash"
    }
}

/// Restore works where the system records each item's original folder: Windows and Linux. macOS keeps that private
/// to Finder, so there LocatorZero finds items and shows them in the Trash, and Finder's "Put Back" restores them.
pub fn can_restore() -> bool {
    cfg!(any(windows, all(unix, not(target_os = "macos"))))
}

fn matches(toks: &[String], name: &str, place: &str) -> bool {
    let hay = format!("{name} {place}").to_lowercase();
    toks.iter().all(|t| hay.contains(t.as_str()))
}

#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
mod imp {
    use super::*;
    use std::sync::Mutex;

    /// Items from the latest listing, the only ones Restore accepts. Dropped on wipe and idle timeout.
    static LAST: Mutex<Vec<trash::TrashItem>> = Mutex::new(Vec::new());

    /// An empty query lists the most recently deleted items, so choosing the bin shows what just went there.
    pub fn search(toks: &[String], limit: usize) -> Result<Vec<Hit>, String> {
        let mut items: Vec<trash::TrashItem> = trash::os_limited::list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|it| matches(toks, &it.name.to_string_lossy(), &it.original_parent.to_string_lossy()))
            .collect();
        items.sort_by(|a, b| b.time_deleted.cmp(&a.time_deleted));
        items.truncate(limit);
        let hits = items
            .iter()
            .map(|it| {
                let meta = trash::os_limited::metadata(it).ok();
                let folder = matches!(meta.map(|m| m.size), Some(trash::TrashItemSize::Entries(_)));
                Hit {
                    n: it.name.to_string_lossy().into_owned(),
                    p: it.original_path().to_string_lossy().into_owned(),
                    s: "trash",
                    src: bin_label().into(),
                    k: folder.then_some("folder"),
                    z: meta.and_then(|m| m.size.size()),
                    t: (it.time_deleted > 0).then_some(it.time_deleted * 1000),
                    url: None,
                    id: Some(it.id.to_string_lossy().into_owned()),
                }
            })
            .collect();
        *LAST.lock().unwrap_or_else(|e| e.into_inner()) = items;
        Ok(hits)
    }

    pub fn restore(ids: &[String]) -> Result<Vec<String>, String> {
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        let mut picked = Vec::new();
        for id in ids {
            let it = last
                .iter()
                .find(|it| it.id.to_string_lossy() == id.as_str())
                .ok_or("That item is not in the latest list from your bin. Search again, then restore it.")?;
            let dest = it.original_path();
            if dest.symlink_metadata().is_ok() {
                return Err(format!(
                    "Something called “{}” is already in {}. Nothing was overwritten. Rename or move it, then restore again.",
                    it.name.to_string_lossy(),
                    it.original_parent.display()
                ));
            }
            picked.push(it.clone());
        }
        let paths: Vec<String> = picked.iter().map(|it| it.original_path().to_string_lossy().into_owned()).collect();
        trash::os_limited::restore_all(picked.clone()).map_err(|e| match e {
            trash::Error::RestoreCollision { path, .. } => {
                format!("Something is already at {}. Nothing was overwritten. Rename or move it, then restore again.", path.display())
            }
            trash::Error::RestoreTwins { path, .. } => {
                format!("Two items in your bin came from {}. Restore them one at a time.", path.display())
            }
            other => format!("Your system would not restore it: {other}"),
        })?;
        last.retain(|it| !picked.contains(it));
        Ok(paths)
    }

    pub fn forget() {
        LAST.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    /// ~/.Trash, which macOS opens to an app only after the user allows Full Disk Access. Finder keeps where each item
    /// came from to itself, so results carry the item's place in the Trash instead.
    pub fn search(toks: &[String], limit: usize) -> Result<Vec<Hit>, String> {
        let dir = crate::sources::home().ok_or("no home folder")?.join(".Trash");
        let rd = std::fs::read_dir(&dir).map_err(|_| {
            "macOS needs your permission to look in the Trash: System Settings › Privacy & Security › Full Disk Access › LocatorZero".to_string()
        })?;
        let mut hits: Vec<Hit> = rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                if name == ".DS_Store" || !matches(toks, &name, "") {
                    return None;
                }
                let m = e.metadata().ok();
                Some(Hit {
                    n: name,
                    p: e.path().to_string_lossy().into_owned(),
                    s: "trash",
                    src: bin_label().into(),
                    k: m.as_ref().filter(|m| m.is_dir()).map(|_| "folder"),
                    z: m.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
                    t: None,
                    url: None,
                    id: None,
                })
            })
            .collect();
        hits.sort_by(|a, b| a.n.to_lowercase().cmp(&b.n.to_lowercase()));
        hits.truncate(limit);
        Ok(hits)
    }

    pub fn restore(_ids: &[String]) -> Result<Vec<String>, String> {
        Err("On macOS, restore from the Trash with Finder's Put Back.".into())
    }

    pub fn forget() {}
}

pub use imp::{forget, restore, search};

#[cfg(all(test, unix, not(target_os = "macos")))]
mod tests {
    use super::*;

    /// One test touches XDG_DATA_HOME, so everything that depends on it runs here, in order.
    #[test]
    fn finds_a_deleted_file_restores_it_and_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("XDG_DATA_HOME", tmp.path().join("share"));
        std::fs::create_dir_all(tmp.path().join("share")).unwrap();
        let docs = tmp.path().join("Documents");
        std::fs::create_dir_all(&docs).unwrap();
        let f = docs.join("lz-restore-test-budget.txt");
        std::fs::write(&f, b"numbers").unwrap();
        trash::delete(&f).unwrap();
        assert!(!f.exists());

        let toks = vec!["lz-restore-test".to_string()];
        let hits = search(&toks, 50).unwrap();
        assert_eq!(hits.len(), 1, "{hits:?}");
        let h = &hits[0];
        assert_eq!(h.p, f.to_string_lossy());
        assert_eq!(h.s, "trash");
        assert_eq!(h.z, Some(7));
        assert!(h.t.is_some(), "deletion time is shown");
        let id = h.id.clone().unwrap();

        // An id that was never listed is refused.
        assert!(restore(&["/not/listed.trashinfo".into()]).is_err());

        // A new file with the same name blocks the restore, and is left untouched.
        std::fs::write(&f, b"new").unwrap();
        let err = restore(std::slice::from_ref(&id)).unwrap_err();
        assert!(err.contains("Nothing was overwritten"), "{err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"new");
        std::fs::remove_file(&f).unwrap();

        // Then it restores to where it was, with its content.
        let back = restore(std::slice::from_ref(&id)).unwrap();
        assert_eq!(back, vec![f.to_string_lossy().into_owned()]);
        assert_eq!(std::fs::read(&f).unwrap(), b"numbers");
        assert!(search(&toks, 50).unwrap().is_empty());

        // Restored items leave the latest list, so the same id cannot be used twice.
        assert!(restore(&[id]).is_err());
        forget();
    }
}
