//! Places the user can scope a search to: this computer, connected drives (USB, external, network) and cloud
//! folders. Listing them reads only mount tables, folder names and each drive's size, free space and file system.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Place {
    pub label: String,
    /// home, drive, usb, network, cloud or folder
    pub kind: &'static str,
    pub path: String,
    /// true when the system index covers it; otherwise LocatorZero lists it into memory after consent
    pub indexed: bool,
    /// size and free space of the drive that holds it, in bytes, when the system reports them
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free: Option<u64>,
    /// file system, such as NTFS, APFS, ext4 or exFAT
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<String>,
}

pub fn place(label: impl Into<String>, kind: &'static str, path: &Path, indexed: bool) -> Place {
    Place { label: label.into(), kind, path: path.to_string_lossy().into_owned(), indexed, total: None, free: None, fs: None }
}

/// Adds each place's drive size, free space and file system. A network drive that does not answer can stall the
/// system call behind this, so the lookup runs on its own thread and is skipped after a short wait.
pub fn annotate(places: &mut [Place]) {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let v: Vec<(PathBuf, u64, u64, String)> = disks
            .list()
            .iter()
            .map(|d| (d.mount_point().to_path_buf(), d.total_space(), d.available_space(), d.file_system().to_string_lossy().into_owned()))
            .collect();
        let _ = tx.send(v);
    });
    let Ok(disks) = rx.recv_timeout(std::time::Duration::from_millis(400)) else { return };
    for p in places.iter_mut() {
        let path = Path::new(&p.path);
        // The drive whose mount point is the longest prefix of this place holds it.
        if let Some(d) = disks.iter().filter(|d| path.starts_with(&d.0)).max_by_key(|d| d.0.as_os_str().len()) {
            if d.1 > 0 {
                p.total = Some(d.1);
                p.free = Some(d.2);
            }
            if !d.3.is_empty() {
                p.fs = Some(d.3.clone());
            }
        }
    }
}

/// Parse /proc/mounts lines into removable, external and network places.
pub fn parse_mounts(text: &str) -> Vec<Place> {
    let mut out = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 3 {
            continue;
        }
        let (dev, mnt, fs) = (f[0], f[1].replace("\\040", " "), f[2]);
        let network = matches!(fs, "nfs" | "nfs4" | "cifs" | "smb3" | "smbfs" | "fuse.sshfs" | "9p" | "davfs" | "fuse.rclone");
        let removable_place = mnt.starts_with("/media/") || mnt.starts_with("/run/media/") || mnt.starts_with("/mnt/");
        if !(network || removable_place) || fs == "squashfs" || dev.starts_with("/dev/loop") {
            continue;
        }
        let name = Path::new(&mnt).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| mnt.clone());
        let kind = if network { "network" } else if mnt.starts_with("/mnt/") { "drive" } else { "usb" };
        out.push(place(name, kind, Path::new(&mnt), false));
    }
    out
}

fn cloud_folders(home: &Path) -> Vec<Place> {
    let mut v = Vec::new();
    let mut add = |label: &str, p: PathBuf| {
        if p.is_dir() {
            v.push(place(label, "cloud", &p, true));
        }
    };
    for (label, dir) in [("Dropbox", "Dropbox"), ("OneDrive", "OneDrive"), ("Google Drive", "Google Drive"), ("Nextcloud", "Nextcloud"), ("pCloud", "pCloudDrive"), ("MEGA", "MEGA")] {
        add(label, home.join(dir));
    }
    if cfg!(target_os = "macos") {
        add("iCloud Drive", home.join("Library/Mobile Documents/com~apple~CloudDocs"));
        if let Ok(rd) = std::fs::read_dir(home.join("Library/CloudStorage")) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                let label = name.split('-').next().unwrap_or(&name).to_string();
                add(&label, e.path());
            }
        }
    }
    v
}

pub fn list() -> Vec<Place> {
    let mut v = Vec::new();
    if let Some(h) = crate::sources::home() {
        v.push(place("Your home folder", "home", &h, true));
        v.extend(cloud_folders(&h));
    }
    if cfg!(target_os = "linux") {
        if let Ok(m) = std::fs::read_to_string("/proc/mounts") {
            v.extend(parse_mounts(&m));
        }
    } else if cfg!(target_os = "macos") {
        if let Ok(rd) = std::fs::read_dir("/Volumes") {
            for e in rd.flatten() {
                // The startup disk appears here as a link to /; it is already "your computer".
                if e.path().read_link().is_ok() {
                    continue;
                }
                v.push(place(e.file_name().to_string_lossy(), "drive", &e.path(), true));
            }
        }
    } else if cfg!(windows) {
        for l in b'C'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", l as char));
            if root.exists() {
                v.push(place(format!("Drive {}:", l as char), "drive", &root, l == b'C'));
            }
        }
    }
    annotate(&mut v);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounts_become_places_and_system_mounts_are_skipped() {
        let text = "\
/dev/sda1 / ext4 rw 0 0
proc /proc proc rw 0 0
/dev/sdb1 /media/kali/USB\\040STICK vfat rw 0 0
/dev/sdc1 /run/media/ana/Backup exfat rw 0 0
//nas/team /mnt/team cifs rw 0 0
nas:/export /srv/nfs nfs4 rw 0 0
/dev/loop3 /media/snap/core squashfs ro 0 0";
        let p = parse_mounts(text);
        let got: Vec<(&str, &str, &str)> = p.iter().map(|x| (x.label.as_str(), x.kind, x.path.as_str())).collect();
        assert_eq!(
            got,
            [
                ("USB STICK", "usb", "/media/kali/USB STICK"),
                ("Backup", "usb", "/run/media/ana/Backup"),
                ("team", "network", "/mnt/team"),
                ("nfs", "network", "/srv/nfs"),
            ]
        );
        assert!(p.iter().all(|x| !x.indexed), "drives are listed into memory, not read from the system index");
    }
}
