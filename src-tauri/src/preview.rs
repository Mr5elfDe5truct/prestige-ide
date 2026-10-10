// Screenshots of the app being built, for the agent's preview_page tool: headless Edge (or Chrome) loads a local dev
// server's page, saves a PNG and reports the page's console messages. Local addresses only, so it can't be used to
// send anything out.
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize)]
pub struct Snapshot {
    image: String, // PNG, base64
    console: Vec<String>,
    browser: String,
}

/// http(s) on this PC only: localhost, 127.x, [::1] or *.localhost.
pub fn is_local_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")) else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return false; // user:pass@host could disguise the real host
    }
    let host = if authority.starts_with('[') {
        authority.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or("").to_string()
    }
    .to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost") || host == "[::1]" || (host.starts_with("127.") && host.split('.').count() == 4 && host.split('.').all(|p| p.parse::<u8>().is_ok()))
}

fn find_browser() -> Option<PathBuf> {
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    [
        format!(r"{pf86}\Microsoft\Edge\Application\msedge.exe"),
        format!(r"{pf}\Microsoft\Edge\Application\msedge.exe"),
        format!(r"{pf}\Google\Chrome\Application\chrome.exe"),
        format!(r"{pf86}\Google\Chrome\Application\chrome.exe"),
        format!(r"{local}\Google\Chrome\Application\chrome.exe"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|p| p.exists())
}

/// Console lines from Chromium's log, in either of its formats:
///   [..:INFO:CONSOLE(12)] "message", source: http://… (12)
///   [..:INFO:CONSOLE:12] "message", source: http://… (12)
/// Chrome logs uncaught errors at INFO too, so they're picked out by their text.
pub fn console_lines(log: &str) -> Vec<String> {
    log.lines()
        .filter_map(|l| {
            let i = l.find(":CONSOLE(").or_else(|| l.find(":CONSOLE:"))?;
            let level = l[..i].rsplit(':').next().unwrap_or("INFO");
            let msg = l[i..].split_once("] ").map(|x| x.1).unwrap_or(l).trim();
            let kind = if msg.contains("Uncaught") || level == "ERROR" {
                "error"
            } else if level == "WARNING" {
                "warning"
            } else {
                "log"
            };
            Some(format!("{kind}: {msg}"))
        })
        .take(80)
        .collect()
}

#[tauri::command(async)]
pub fn page_snapshot(url: String, width: Option<u32>, height: Option<u32>) -> Result<Snapshot, String> {
    if !is_local_url(&url) {
        return Err(format!("{url} isn't a local address: preview_page only opens http://localhost:… pages of the app you're building"));
    }
    let browser = find_browser().ok_or("neither Microsoft Edge nor Chrome was found")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("pide-snap-{stamp}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let shot = dir.join("shot.png");
    let (w, h) = (width.unwrap_or(1280).clamp(320, 2560), height.unwrap_or(800).clamp(240, 2560));
    let mut c = Command::new(&browser);
    c.args([
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--enable-logging=stderr",
        "--v=0",
        "--virtual-time-budget=6000",
    ])
    .arg(format!("--user-data-dir={}", dir.join("profile").display()))
    .arg(format!("--window-size={w},{h}"))
    .arg(format!("--screenshot={}", shot.display()))
    .arg(&url)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    let mut child = c.spawn().map_err(|e| format!("couldn't start {}: {e}", browser.display()))?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(e) = stderr.as_mut() {
            let _ = std::io::Read::read_to_string(e, &mut s);
        }
        s
    });
    let start = Instant::now();
    loop {
        if child.try_wait().map(|s| s.is_some()).unwrap_or(true) {
            break;
        }
        if start.elapsed() > Duration::from_secs(45) {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let log = reader.join().unwrap_or_default();
    let result = read_png(&shot).map(|image| Snapshot { image, console: console_lines(&log), browser: browser.display().to_string() });
    let _ = std::fs::remove_dir_all(&dir);
    result.map_err(|e| format!("{e}. Is the dev server running at {url}?"))
}

fn read_png(p: &Path) -> Result<String, String> {
    let bytes = std::fs::read(p).map_err(|_| "the browser didn't produce a screenshot".to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_addresses() {
        for ok in ["http://localhost:5173/", "http://127.0.0.1:3000/a?b", "https://localhost", "http://app.localhost:8080", "http://[::1]:5173/", "http://127.1.2.3/"] {
            assert!(is_local_url(ok), "{ok}");
        }
        for bad in [
            "http://example.com",
            "https://localhost.evil.com/",
            "http://127.0.0.1.evil.com/",
            "http://evil.com@localhost/",
            "http://localhost@evil.com/",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "http://192.168.1.5:3000",
            "localhost:3000",
            "http://127.0.0.256/",
        ] {
            assert!(!is_local_url(bad), "{bad}");
        }
    }

    #[test]
    fn reads_console_lines() {
        let log = "[1:2:1009/120000.1:INFO:CONSOLE(12)] \"hello\", source: http://localhost:5173/main.js (12)\n\
                   [1:2:1009/120000.2:ERROR:CONSOLE(3)] \"Uncaught TypeError: x is undefined\", source: http://localhost:5173/a.js (3)\n\
                   [1:2:1009/120000.3:WARNING:gpu_init.cc(1)] not console\n\
                   [20740:15900:1009/214425.352:INFO:CONSOLE:3] \"hello from the page\", source: http://127.0.0.1:8765/ (3)\n\
                   [20740:15900:1009/214425.352:INFO:CONSOLE:3] \"Uncaught ReferenceError: f is not defined\", source: http://127.0.0.1:8765/ (3)";
        assert_eq!(
            console_lines(log),
            [
                "log: \"hello\", source: http://localhost:5173/main.js (12)",
                "error: \"Uncaught TypeError: x is undefined\", source: http://localhost:5173/a.js (3)",
                "log: \"hello from the page\", source: http://127.0.0.1:8765/ (3)",
                "error: \"Uncaught ReferenceError: f is not defined\", source: http://127.0.0.1:8765/ (3)"
            ]
        );
    }
}
