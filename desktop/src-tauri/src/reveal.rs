//! Hand-off: show a file in the system file manager, or open a web address in the default browser.
//! LocatorZero itself opens nothing: it never launches the located file, only its containing folder.

use std::path::Path;
use std::process::{Command, Stdio};

pub fn reveal(path: Option<&str>, url: Option<&str>) -> Result<(), String> {
    if let Some(u) = url {
        if !(u.starts_with("https://") || u.starts_with("http://")) {
            return Err("only web addresses can be opened".into());
        }
        return spawn(opener(), &[u]);
    }
    let p = Path::new(path.ok_or("nothing to reveal")?);
    if !p.exists() {
        return Err("that location no longer exists".into());
    }
    #[cfg(target_os = "macos")]
    return spawn("open", &["-R", &p.to_string_lossy()]);
    #[cfg(windows)]
    return spawn("explorer", &[&format!("/select,{}", p.display())]);
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Ask the file manager to highlight the item; fall back to opening the folder that holds it.
        let uri = format!("file://{}", p.display());
        let ok = Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:{uri}"),
                "string:",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
        let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        spawn("xdg-open", &[&dir.to_string_lossy()])
    }
}

fn opener() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    }
}

fn spawn(cmd: &str, args: &[&str]) -> Result<(), String> {
    Command::new(cmd).args(args).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| e.to_string())
}
