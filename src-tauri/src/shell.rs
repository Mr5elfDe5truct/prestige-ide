// Shell commands the agent runs: PowerShell in the project folder, output streamed as it comes, with a timeout and Stop.
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_OUT: usize = 60_000;

#[derive(Default)]
pub struct Running(pub Mutex<HashMap<String, u32>>);

#[derive(Serialize)]
pub struct CmdResult {
    output: String,
    code: Option<i32>,
    timed_out: bool,
    killed: bool,
}

#[derive(Serialize, Clone)]
struct Chunk {
    data: String,
}

fn kill_tree(pid: u32) {
    let mut c = Command::new("taskkill");
    c.args(["/T", "/F", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    let _ = c.status();
}

#[tauri::command(async)]
pub fn run_command(
    app: AppHandle,
    running: State<'_, Running>,
    id: String,
    cwd: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let mut c = Command::new("powershell.exe");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"])
        // Make output UTF-8 and stop PowerShell's progress bars from flooding the transcript.
        .arg(format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; {command}"
        ))
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    let mut child = c.spawn().map_err(|e| format!("could not start PowerShell: {e}"))?;
    let pid = child.id();
    running.0.lock().unwrap().insert(id.clone(), pid);

    let out = Arc::new(Mutex::new(String::new()));
    let mut readers = Vec::new();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
    {
        let out = out.clone();
        let app = app.clone();
        let ev = format!("cmd-out-{id}");
        readers.push(std::thread::spawn(move || {
            let mut stream = stream;
            let mut buf = [0u8; 8192];
            let mut carry: Vec<u8> = Vec::new();
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                carry.extend_from_slice(&buf[..n]);
                // Only hand over whole UTF-8 characters.
                let cut = match std::str::from_utf8(&carry) {
                    Ok(_) => carry.len(),
                    Err(e) => e.valid_up_to(),
                };
                if cut == 0 {
                    continue;
                }
                let text = String::from_utf8_lossy(&carry[..cut]).into_owned();
                carry.drain(..cut);
                let _ = app.emit(&ev, Chunk { data: text.clone() });
                let mut o = out.lock().unwrap();
                if o.len() < MAX_OUT * 2 {
                    o.push_str(&text);
                }
            }
        }));
    }

    let limit = Duration::from_millis(timeout_ms.unwrap_or(120_000).min(600_000));
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {}
            Err(_) => break None,
        }
        if !running.0.lock().unwrap().contains_key(&id) {
            kill_tree(pid);
            break child.wait().ok();
        }
        if start.elapsed() > limit {
            timed_out = true;
            kill_tree(pid);
            break child.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    for r in readers {
        let _ = r.join();
    }
    let killed = running.0.lock().unwrap().remove(&id).is_none() && !timed_out;
    let mut output = out.lock().unwrap().clone();
    if output.len() > MAX_OUT {
        let head: String = output.chars().take(MAX_OUT / 3).collect();
        let tail: String = output.chars().rev().take(MAX_OUT * 2 / 3).collect::<Vec<_>>().into_iter().rev().collect();
        output = format!("{head}\n\n… [{} characters cut] …\n\n{tail}", output.len() - MAX_OUT);
    }
    Ok(CmdResult { output, code: status.and_then(|s| s.code()), timed_out, killed })
}

#[tauri::command]
pub fn kill_command(running: State<'_, Running>, id: String) {
    // Removing the id tells run_command's loop to kill the process tree.
    if let Some(pid) = running.0.lock().unwrap().remove(&id) {
        kill_tree(pid);
    }
}
