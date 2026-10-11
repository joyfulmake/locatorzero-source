use serde::Serialize;

/// A located thing. Field names match the web app's item shape so the UI treats native and in-browser results alike.
/// There is deliberately no field that can carry content.
#[derive(Serialize, Debug, Clone)]
pub struct Hit {
    /// display name
    pub n: String,
    /// full path, or browser/profile/host for history
    pub p: String,
    /// source id: files, history, proc
    pub s: &'static str,
    /// source label shown to the user
    pub src: String,
    /// kind when the source knows it better than the file extension does
    #[serde(skip_serializing_if = "Option::is_none")]
    pub k: Option<&'static str>,
    /// size in bytes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z: Option<u64>,
    /// modified, visited or started, in ms since the Unix epoch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}
