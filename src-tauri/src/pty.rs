// Real terminals for the Terminal pane (ConPTY on Windows), one per tab.
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Terms(Mutex<HashMap<String, Term>>);

#[derive(Serialize, Clone)]
struct Out {
    data: String,
}

#[tauri::command]
pub fn pty_spawn(app: AppHandle, terms: State<'_, Terms>, id: String, cwd: String, cols: u16, rows: u16) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    if std::path::Path::new(&cwd).is_dir() {
        cmd.cwd(&cwd);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let ev = format!("pty-out-{id}");
    let exit_ev = format!("pty-exit-{id}");
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut carry: Vec<u8> = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            carry.extend_from_slice(&buf[..n]);
            let cut = match std::str::from_utf8(&carry) {
                Ok(_) => carry.len(),
                Err(e) if e.error_len().is_none() => e.valid_up_to(),
                Err(_) => carry.len(), // invalid bytes: send them lossily rather than stall
            };
            if cut == 0 {
                continue;
            }
            let text = String::from_utf8_lossy(&carry[..cut]).into_owned();
            carry.drain(..cut);
            let _ = app2.emit(&ev, Out { data: text });
        }
    });
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app.emit(&exit_ev, ());
    });
    terms.0.lock().unwrap().insert(id, Term { master: pair.master, writer, killer });
    Ok(())
}

#[tauri::command]
pub fn pty_write(terms: State<'_, Terms>, id: String, data: String) -> Result<(), String> {
    let mut t = terms.0.lock().unwrap();
    let term = t.get_mut(&id).ok_or("no such terminal")?;
    term.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(terms: State<'_, Terms>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let t = terms.0.lock().unwrap();
    let term = t.get(&id).ok_or("no such terminal")?;
    term.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(terms: State<'_, Terms>, id: String) {
    if let Some(mut t) = terms.0.lock().unwrap().remove(&id) {
        let _ = t.killer.kill();
    }
}
