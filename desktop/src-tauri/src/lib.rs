//! LocatorZero desktop core. Every command here reads, with three exceptions the user starts: the opt-in tabs host
//! registration, Clean up, which moves files the user ticked and confirmed to the system's bin (see cleanup.rs), and
//! Restore, which puts an item the user confirmed back where it was deleted from (see sources/trash.rs).
//! No networking crate is a dependency (see desktop/check-no-network.sh), and the only socket is a private Unix
//! socket to the tabs extension's host (see tabs.rs). Results carry a location and metadata only.

mod cleanup;
mod hit;
mod licence;
mod places;
mod preview;
mod reveal;
mod sources;
mod tabs;

use hit::Hit;
use serde::Serialize;
use std::time::Instant;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct LocateOut {
    hits: Vec<Hit>,
    ms: f64,
    errors: Vec<String>,
    licence_required: bool,
}

fn licence(app: &tauri::AppHandle) -> licence::Licence {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("locatorzero"));
    licence::Licence::new(&dir)
}

fn tokens(query: &str) -> Vec<String> {
    query.split_whitespace().map(|t| t.to_lowercase()).filter(|t| !t.is_empty()).take(8).collect()
}

/// Search the enabled native sources. Runs off the UI thread; each source answers independently so one slow
/// or missing source never blocks the others.
#[derive(serde::Deserialize)]
struct Scope {
    path: String,
    indexed: bool,
}

#[tauri::command]
async fn locate(app: tauri::AppHandle, query: String, sources: Vec<String>, limit: Option<usize>, scope: Option<Scope>) -> LocateOut {
    if !licence(&app).status().allowed() {
        let mut query = query;
        zeroize::Zeroize::zeroize(&mut query);
        return LocateOut { hits: vec![], ms: 0.0, errors: vec![], licence_required: true };
    }
    if let Some(sc) = scope {
        // One chosen place on disk: files only, from that place.
        use zeroize::Zeroize;
        let t0 = Instant::now();
        let mut query = query;
        let mut toks = tokens(&query);
        query.zeroize();
        let out = if toks.is_empty() {
            Ok(vec![])
        } else {
            sources::files::search_in(&toks, limit.unwrap_or(400).min(2000), std::path::Path::new(&sc.path), sc.indexed)
        };
        toks.iter_mut().for_each(|t| t.zeroize());
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        return match out {
            Ok(hits) => LocateOut { hits, ms, errors: vec![], licence_required: false },
            Err(e) => LocateOut { hits: vec![], ms, errors: vec![format!("files: {e}")], licence_required: false },
        };
    }
    search_sources(query, sources, limit).await
}

/// Places the user can choose to search in: home, cloud folders, connected drives.
#[tauri::command]
async fn places() -> Vec<places::Place> {
    places::list()
}

/// The system folder picker, opened by the core so the interface needs no file-system permission.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<places::Place> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_title("Choose a folder for LocatorZero to search").blocking_pick_folder()?;
    let path = picked.into_path().ok()?;
    let label = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    let mut picked = [places::place(label, "folder", &path, false)];
    places::annotate(&mut picked);
    let [picked] = picked;
    Some(picked)
}

/// Progress of the in-memory listing of a chosen place.
#[tauri::command]
fn place_progress(path: String) -> (usize, bool) {
    sources::files::place_progress(std::path::Path::new(&path))
}

/// Drop every in-memory listing of chosen places (wipe, idle timeout).
#[tauri::command]
fn forget() {
    sources::files::forget();
    sources::trash::forget();
    cleanup::forget();
}

/// Put items the user confirmed back where they were deleted from. Only items from the latest listing of the bin
/// qualify, and nothing is ever overwritten. Returns the restored paths.
#[tauri::command]
async fn trash_restore(ids: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || sources::trash::restore(&ids)).await.map_err(|e| e.to_string())?
}

/// Open the Recycle Bin or Trash in the system file manager.
#[tauri::command]
fn open_bin() -> Result<(), String> {
    reveal::open_bin()
}

/// Clean up: find duplicate and large files in one place the user chose and consented to.
#[tauri::command]
async fn cleanup_scan(app: tauri::AppHandle, path: String) -> Result<cleanup::ScanOut, String> {
    if !licence(&app).status().allowed() {
        return Err("Your free trial has ended. Enter a licence key in the sidebar to keep using Clean up.".into());
    }
    tauri::async_runtime::spawn_blocking(move || cleanup::scan(std::path::Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn cleanup_progress() -> cleanup::Progress {
    cleanup::progress()
}

/// Stop a running scan and drop its results.
#[tauri::command]
fn cleanup_stop() {
    cleanup::forget();
}

/// Move files the user ticked and confirmed to the system's bin. Only files from the latest scan qualify, and a
/// duplicate moves only if it is still byte-for-byte the same as the copy being kept.
#[tauri::command]
async fn cleanup_trash(app: tauri::AppHandle, items: Vec<cleanup::TrashItem>) -> Result<cleanup::TrashOut, String> {
    if !licence(&app).status().allowed() {
        return Err("Your free trial has ended. Enter a licence key in the sidebar to keep using Clean up.".into());
    }
    tauri::async_runtime::spawn_blocking(move || cleanup::trash_with(&items, to_bin)).await.map_err(|e| e.to_string())
}

/// To the Recycle Bin (Windows) or Trash (macOS, Linux), where it can be restored. Never a permanent delete.
fn to_bin(p: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // The file manager API, not Finder scripting, so no automation permission prompt.
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(p).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(p).map_err(|e| e.to_string())
    }
}

async fn search_sources(query: String, sources: Vec<String>, limit: Option<usize>) -> LocateOut {
    use zeroize::Zeroize;
    let t0 = Instant::now();
    let mut query = query;
    let mut toks = tokens(&query);
    query.zeroize();
    let limit = limit.unwrap_or(400).min(2000);
    let want = |s: &str| sources.iter().any(|x| x == s);
    // An empty query means something only in the bin, where it lists the most recently deleted items.
    let bin_only = sources.len() == 1 && want("trash");
    if toks.is_empty() && !bin_only {
        return LocateOut { hits: vec![], ms: 0.0, errors: vec![], licence_required: false };
    }
    let (files, history, procs, open_tabs, bin) = std::thread::scope(|sc| {
        let f = sc.spawn(|| if want("files") { sources::files::search(&toks, limit) } else { Ok(vec![]) });
        let h = sc.spawn(|| if want("history") { sources::history::search(&toks, limit / 2) } else { Ok(vec![]) });
        let p = sc.spawn(|| if want("proc") { Ok(sources::procs::search(&toks, 100)) } else { Ok(vec![]) });
        let t = sc.spawn(|| if want("tabs") { Ok(tabs::search(&toks, 100)) } else { Ok(vec![]) });
        let b = sc.spawn(|| if want("trash") { sources::trash::search(&toks, 300) } else { Ok(vec![]) });
        (f.join(), h.join(), p.join(), t.join(), b.join())
    });
    let mut hits = Vec::new();
    let mut errors = Vec::new();
    for (label, r) in [("files", files), ("history", history), ("processes", procs), ("tabs", open_tabs), ("bin", bin)] {
        match r {
            Ok(Ok(mut v)) => hits.append(&mut v),
            Ok(Err(e)) => errors.push(format!("{label}: {e}")),
            Err(_) => errors.push(format!("{label}: source crashed")),
        }
    }
    // Our own copies of what was typed are overwritten, not just freed. Copies inside the webview and the IPC
    // layer are outside this code's reach; docs/measurements.md records how many remain.
    toks.iter_mut().for_each(|t| t.zeroize());
    LocateOut { hits, ms: t0.elapsed().as_secs_f64() * 1000.0, errors, licence_required: false }
}

#[tauri::command]
async fn preview(app: tauri::AppHandle, path: String) -> Result<preview::PreviewOut, String> {
    if !licence(&app).status().allowed() {
        return Err("Your free trial has ended. Enter a licence key in the sidebar to keep previewing.".into());
    }
    preview::preview(std::path::Path::new(&path))
}

#[tauri::command]
fn reveal(path: Option<String>, url: Option<String>) -> Result<(), String> {
    reveal::reveal(path.as_deref(), url.as_deref())
}

#[derive(Serialize)]
struct Status {
    version: &'static str,
    platform: &'static str,
    sources: Vec<sources::SourceStatus>,
    network_libraries: bool,
    /// the shortcut that brings LocatorZero to the front, or None when the system refused it
    hotkey: Option<String>,
    bin: &'static str,
    can_restore: bool,
}

static HOTKEY: std::sync::OnceLock<Result<String, String>> = std::sync::OnceLock::new();

#[tauri::command]
async fn status() -> Status {
    Status {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        sources: vec![sources::files::status(), tabs::status(), sources::history::status(), sources::procs::status()],
        network_libraries: false,
        hotkey: HOTKEY.get().and_then(|r| r.as_ref().ok().cloned()),
        bin: sources::trash::bin_label(),
        can_restore: sources::trash::can_restore(),
    }
}

#[tauri::command]
fn licence_status(app: tauri::AppHandle) -> licence::Status {
    licence(&app).status()
}

#[tauri::command]
fn licence_activate(app: tauri::AppHandle, key: String) -> Result<licence::Status, String> {
    licence(&app).activate(&key)
}

#[tauri::command]
fn licence_remove(app: tauri::AppHandle) -> Result<licence::Status, String> {
    licence(&app).remove()
}

#[derive(Serialize)]
struct TabsSetup {
    browsers: Vec<String>,
    extension_dir: Option<String>,
}

/// Registers LocatorZero as the tabs host with installed browsers, and says where the bundled extension is.
#[tauri::command]
fn setup_tabs(app: tauri::AppHandle) -> Result<TabsSetup, String> {
    let browsers = tabs::install()?;
    let bundled = app.path().resolve("extension", tauri::path::BaseDirectory::Resource).ok().filter(|p| p.join("manifest.json").is_file());
    // Development builds only: release builds must not carry the source folder's path.
    #[cfg(debug_assertions)]
    let bundled = bundled.or_else(|| {
        let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extension");
        dev.join("manifest.json").is_file().then_some(dev)
    });
    let dir = bundled;
    Ok(TabsSetup { browsers, extension_dir: dir.map(|d| d.canonicalize().unwrap_or(d).to_string_lossy().into_owned()) })
}

/// Linux: no core dumps of this process, and other programs running as the same user cannot attach to it or read
/// its memory. (The webview runs in separate processes this flag does not cover.)
fn harden() {
    #[cfg(target_os = "linux")]
    {
        extern "C" {
            fn prctl(option: i32, ...) -> i32;
        }
        const PR_SET_DUMPABLE: i32 = 4;
        // SAFETY: PR_SET_DUMPABLE takes one integer argument and only changes this process's own flag.
        unsafe {
            prctl(PR_SET_DUMPABLE, 0);
        }
    }
}

/// Ctrl+Shift+Space (Cmd+Shift+Space on a Mac): LocatorZero comes to the front with the search field ready.
fn hotkey() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let main = if cfg!(target_os = "macos") { Modifiers::SUPER } else { Modifiers::CONTROL };
    Shortcut::new(Some(main | Modifiers::SHIFT), Code::Space)
}

fn hotkey_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "⌘ Shift Space"
    } else {
        "Ctrl Shift Space"
    }
}

fn bring_to_front(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("lz-focus", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    harden();
    let args: Vec<String> = std::env::args().collect();
    if tabs::launched_as_host(&args) {
        tabs::run_host();
        return;
    }
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        bring_to_front(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Another app may already own the shortcut. Then LocatorZero simply runs without it.
            let r = app.global_shortcut().register(hotkey()).map(|_| hotkey_label().to_string()).map_err(|e| e.to_string());
            if let Err(e) = &r {
                eprintln!("LocatorZero: shortcut {} unavailable: {e}", hotkey_label());
            }
            let _ = HOTKEY.set(r);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            locate, preview, reveal, status, setup_tabs, licence_status, licence_activate, licence_remove, places, pick_folder, place_progress,
            forget, cleanup_scan, cleanup_progress, cleanup_stop, cleanup_trash, trash_restore, open_bin
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocatorZero");
}

#[cfg(test)]
mod bench {
    /// Search latency on this machine's real sources, as percentiles. Not a pass/fail test:
    /// cargo test --release bench_locate -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_locate() {
        let words = [
            "config", "readme", "budget", "png", "notes", "log", "license", "main", "index", "test", "kali", "chrome", "python",
            "report 2025", "zzzzqx", "docs", "settings", "invoice", "history", "cache",
        ];
        let sources: Vec<String> = ["files", "history", "proc", "tabs"].iter().map(|s| s.to_string()).collect();
        let rt = tauri::async_runtime::block_on(async {
            let mut all = Vec::new();
            for i in 0..100 {
                let q = words[i % words.len()].to_string();
                let t0 = std::time::Instant::now();
                let out = super::search_sources(q, sources.clone(), None).await;
                all.push((t0.elapsed().as_secs_f64() * 1000.0, out.hits.len()));
            }
            all
        });
        let mut ms: Vec<f64> = rt.iter().map(|r| r.0).collect();
        ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p = |q: f64| ms[((q / 100.0) * ms.len() as f64) as usize].min(ms[ms.len() - 1]);
        let hits: usize = rt.iter().map(|r| r.1).sum();
        for src in ["files", "history", "proc", "tabs"] {
            let mut v: Vec<f64> = (0..40)
                .map(|i| {
                    let q = vec![words[i % words.len()].to_string()];
                    let t0 = std::time::Instant::now();
                    match src {
                        "files" => drop(crate::sources::files::search(&q, 400)),
                        "history" => drop(crate::sources::history::search(&q, 200)),
                        "proc" => drop(crate::sources::procs::search(&q, 100)),
                        _ => drop(crate::tabs::search(&q, 100)),
                    }
                    t0.elapsed().as_secs_f64() * 1000.0
                })
                .collect();
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("BENCH {src:8} p50 {:.1} ms  p95 {:.1} ms  max {:.1} ms", v[20], v[38], v[39]);
        }
        println!("BENCH locate (files+history+processes+tabs), 100 queries: p50 {:.1} ms, p95 {:.1} ms, p99 {:.1} ms, max {:.1} ms, avg hits {}", p(50.0), p(95.0), p(99.0), ms[ms.len() - 1], hits / 100);
    }
}
