//! Runs the real binary as a browser would launch it, feeds it a tab list over native messaging, and reads the
//! list back over the private socket, the way the LocatorZero window does.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::time::Duration;

#[test]
fn host_round_trip_over_the_private_socket() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_locatorzero"))
        .arg("chrome-extension://lkodnhoihmagdbkmcicjjjgfipmfphio/")
        .env("XDG_RUNTIME_DIR", dir.path())
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let msg = br#"{"type":"tabs","browser":"Chromium","tabs":[{"w":3,"url":"https://wiki.example.org/atlas","title":"Project Atlas","last":5}]}"#;
    let stdin = child.stdin.as_mut().unwrap();
    stdin.write_all(&(msg.len() as u32).to_ne_bytes()).unwrap();
    stdin.write_all(msg).unwrap();
    stdin.flush().unwrap();

    let sock_dir = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.path()).find(|p| p.is_dir());
    let mut reply = String::new();
    for _ in 0..60 {
        std::thread::sleep(Duration::from_millis(50));
        let Some(d) = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.path()).find(|p| p.is_dir()) else { continue };
        let Some(sock) = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.path()).next() else { continue };
        let Ok(mut s) = UnixStream::connect(&sock) else { continue };
        s.write_all(b"list\n").unwrap();
        reply.clear();
        BufReader::new(&s).read_line(&mut reply).unwrap();
        if reply.contains("Project Atlas") {
            assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700, "socket folder is not private");
            assert_eq!(std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777, 0o600, "socket is not private");
            break;
        }
    }
    let _ = sock_dir;
    assert!(reply.contains("Project Atlas"), "no tab came back: {reply:?}");

    drop(child.stdin.take()); // the browser closes the pipe
    let status = child.wait().unwrap();
    assert!(status.success());
    let d = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.path()).find(|p| p.is_dir()).unwrap();
    assert!(std::fs::read_dir(&d).unwrap().next().is_none(), "socket left behind after the browser closed");
}
