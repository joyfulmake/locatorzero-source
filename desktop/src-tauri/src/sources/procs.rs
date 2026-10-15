//! Running processes: the same facts a task manager shows. Process memory is never read.

use super::SourceStatus;
use crate::hit::Hit;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users};

pub fn status() -> SourceStatus {
    SourceStatus {
        id: "proc",
        label: "Running processes",
        available: true,
        mode: "process list, as a task manager shows it".into(),
        age_ms: Some(0),
        degraded: false,
        note: "Other users' processes may show without their program path unless LocatorZero runs with more rights.".into(),
    }
}

pub fn search(toks: &[String], limit: usize) -> Vec<Hit> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet).with_user(UpdateKind::OnlyIfNotSet),
    );
    let users = Users::new_with_refreshed_list();
    let mut out: Vec<Hit> = sys
        .processes()
        .iter()
        .filter_map(|(pid, p)| {
            let name = p.name().to_string_lossy().into_owned();
            let exe = p.exe().map(|e| e.to_string_lossy().into_owned());
            let hay = format!("{} {}", name, exe.as_deref().unwrap_or("")).to_lowercase();
            if !toks.iter().all(|t| hay.contains(t.as_str())) {
                return None;
            }
            let user = p
                .user_id()
                .and_then(|u| users.get_user_by_id(u))
                .map(|u| u.name().to_string())
                .unwrap_or_else(|| "unknown user".into());
            Some(Hit {
                n: format!("{name} · pid {pid}"),
                p: exe.unwrap_or_else(|| format!("{user}/{name}")),
                s: "proc",
                src: "Running processes".into(),
                k: Some("proc"),
                z: None,
                t: Some(p.start_time() as i64 * 1000),
                url: None,
                id: None,
            })
        })
        .collect();
    out.sort_by(|a, b| a.n.len().cmp(&b.n.len()));
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_the_test_process_itself() {
        let me = std::env::current_exe().unwrap();
        let name = me.file_name().unwrap().to_string_lossy().to_lowercase();
        let tok = name.chars().take(12).collect::<String>();
        let hits = super::search(&[tok], 50);
        assert!(hits.iter().any(|h| h.n.ends_with(&format!("pid {}", std::process::id()))), "{hits:?}");
    }
}
