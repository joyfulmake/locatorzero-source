//! Bounded preview of one file the user picked: at most 64 KB for text, or one image up to 10 MB.
//! The read buffer is zeroed before it is dropped. Nothing is cached.

use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::time::Instant;
use zeroize::Zeroize;

pub const TEXT_MAX: u64 = 65_536;
pub const IMAGE_MAX: u64 = 10 * 1024 * 1024;

#[derive(Serialize, Debug)]
pub struct PreviewOut {
    /// text, binary, image, empty or none
    pub kind: &'static str,
    pub body: String,
    pub read: u64,
    pub size: u64,
    pub ms: f64,
}

fn ext(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn image_mime(e: &str) -> Option<&'static str> {
    Some(match e {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

const NO_PREVIEW: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key", "zip", "gz", "tgz", "7z",
    "rar", "xz", "bz2", "dmg", "iso", "mp4", "mov", "mkv", "avi", "webm", "mp3", "wav", "m4a", "flac", "ogg", "aac", "heic",
];

pub fn preview(path: &Path) -> Result<PreviewOut, String> {
    let t0 = Instant::now();
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot open: {e}"))?;
    // Regular files only: reading a device, socket or pipe could block or have side effects.
    if !meta.is_file() {
        return Err("not a regular file".into());
    }
    let size = meta.len();
    let done = |kind, body, read| Ok(PreviewOut { kind, body, read, size, ms: t0.elapsed().as_secs_f64() * 1000.0 });
    if size == 0 {
        return done("empty", String::new(), 0);
    }
    let e = ext(path);
    if let Some(mime) = image_mime(&e) {
        if size > IMAGE_MAX {
            return done("none", format!("Image is larger than {} MB, so nothing was read.", IMAGE_MAX / 1024 / 1024), 0);
        }
        let mut buf = Vec::with_capacity(size as usize);
        std::fs::File::open(path).and_then(|f| f.take(IMAGE_MAX).read_to_end(&mut buf)).map_err(|e| e.to_string())?;
        let body = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&buf));
        let read = buf.len() as u64;
        buf.zeroize();
        return done("image", body, read);
    }
    if NO_PREVIEW.contains(&e.as_str()) {
        return done("none", String::new(), 0);
    }
    let mut buf = Vec::with_capacity(TEXT_MAX as usize);
    std::fs::File::open(path).and_then(|f| f.take(TEXT_MAX).read_to_end(&mut buf)).map_err(|e| e.to_string())?;
    let read = buf.len() as u64;
    let binary = buf.iter().take(4096).any(|&b| b == 0);
    let body = if binary { hexdump(&buf[..buf.len().min(512)]) } else { String::from_utf8_lossy(&buf).into_owned() };
    buf.zeroize();
    done(if binary { "binary" } else { "text" }, body, read)
}

fn hexdump(b: &[u8]) -> String {
    let mut out = String::new();
    for (i, row) in b.chunks(16).enumerate() {
        let hex: Vec<String> = row.iter().map(|x| format!("{x:02x}")).collect();
        let asc: String = row.iter().map(|&x| if (32..127).contains(&x) { x as char } else { '.' }).collect();
        out.push_str(&format!("{:06x}  {:<48}  {}\n", i * 16, hex.join(" "), asc));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_preview_stops_at_64_kb() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("big.txt");
        std::fs::write(&p, "x".repeat(200_000)).unwrap();
        let out = preview(&p).unwrap();
        assert_eq!((out.kind, out.read, out.size, out.body.len()), ("text", 65_536, 200_000, 65_536));
    }

    #[test]
    fn binary_is_hex_and_office_files_are_not_read() {
        let d = tempfile::tempdir().unwrap();
        let b = d.path().join("prog.bin");
        std::fs::write(&b, [0u8, 1, 2, 65, 66]).unwrap();
        let out = preview(&b).unwrap();
        assert_eq!(out.kind, "binary");
        assert!(out.body.starts_with("000000  00 01 02 41 42"));
        let x = d.path().join("report.xlsx");
        std::fs::write(&x, b"PK....").unwrap();
        let out = preview(&x).unwrap();
        assert_eq!((out.kind, out.read), ("none", 0));
    }

    #[test]
    fn refuses_directories_and_devices() {
        let d = tempfile::tempdir().unwrap();
        assert!(preview(d.path()).is_err());
        #[cfg(unix)]
        assert!(preview(Path::new("/dev/zero")).is_err());
    }

    #[test]
    fn small_images_come_back_as_data_urls() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.png");
        std::fs::write(&p, [0x89, b'P', b'N', b'G']).unwrap();
        let out = preview(&p).unwrap();
        assert_eq!(out.kind, "image");
        assert!(out.body.starts_with("data:image/png;base64,"));
    }
}
