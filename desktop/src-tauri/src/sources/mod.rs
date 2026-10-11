pub mod files;
pub mod history;
pub mod procs;

use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct SourceStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub available: bool,
    /// how this source is read, in plain words
    pub mode: String,
    /// age of the data behind this source in ms, when known
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_ms: Option<i64>,
    pub degraded: bool,
    pub note: String,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn mtime_ms(m: &std::fs::Metadata) -> Option<i64> {
    m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

pub fn home() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    let h = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let h = std::env::var_os("HOME");
    h.map(Into::into)
}
