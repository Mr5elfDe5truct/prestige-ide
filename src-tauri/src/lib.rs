// Prestige IDE: the native side. Files, search, shell, terminals and the app's own data folder.
mod fsops;
mod pty;
mod shell;

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// A name inside the data folder: plain relative ASCII names only, with no way out of the folder.
fn valid_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains("..")
        && !rel.starts_with('/')
        && !rel.ends_with('/')
        && !rel.contains("//")
        && rel.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c))
}

/// A path inside the app's data folder (%APPDATA%\com.rgstudios.prestige-ide). Only plain relative names are allowed.
fn data_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    if !valid_rel(rel) {
        return Err(format!("bad data path: {rel}"));
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(rel))
}

#[tauri::command(async)]
fn data_read(app: AppHandle, rel: String) -> Result<Option<String>, String> {
    let p = data_path(&app, &rel)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn data_write(app: AppHandle, rel: String, content: String) -> Result<(), String> {
    let p = data_path(&app, &rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write then rename, so a crash mid-write never leaves half a session.
    // Each write gets its own temp name, so two saves of the same file at once can't trip over one temp file.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = p.with_extension(format!("{}-{n}.tmp", std::process::id()));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn data_list(app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    let p = data_path(&app, &dir)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    Ok(fs::read_dir(p)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect())
}

#[tauri::command(async)]
fn data_delete(app: AppHandle, rel: String) -> Result<(), String> {
    let p = data_path(&app, &rel)?;
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// How many NVIDIA cards there are. With two or more, the Workstation runs Ollama and llama.cpp on different cards.
#[tauri::command(async)]
fn gpu_count() -> u32 {
    let mut c = std::process::Command::new("nvidia-smi");
    c.args(["--query-gpu=name", "--format=csv,noheader"]);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    c.output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0)
}

/// Opens a folder or file with Windows' own handler (Explorer for folders).
#[tauri::command(async)]
fn reveal(path: String) -> Result<(), String> {
    let mut c = std::process::Command::new("explorer.exe");
    c.arg(path.replace('/', "\\"));
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(shell::Running::default())
        .manage(pty::Terms::default())
        .invoke_handler(tauri::generate_handler![
            fsops::fs_read,
            fsops::fs_write,
            fsops::fs_exists,
            fsops::fs_delete,
            fsops::fs_list,
            fsops::fs_glob,
            fsops::fs_grep,
            shell::run_command,
            shell::kill_command,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            data_read,
            data_write,
            data_list,
            data_delete,
            gpu_count,
            reveal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prestige IDE");
}

#[cfg(test)]
mod tests {
    use super::valid_rel;

    #[test]
    fn data_names_stay_inside_the_folder() {
        for ok in ["settings.json", "sessions/index.json", "sessions/abc-123_x.json"] {
            assert!(valid_rel(ok), "{ok}");
        }
        for bad in [
            "", "..", "../x.json", "a/../../x", "/etc/passwd", r"\server\x", "C:/Windows/x", "C:x", r"a\b.json",
            "sessions/", "a//b", "séance.json", "a b.json", "a\0b",
        ] {
            assert!(!valid_rel(bad), "{bad:?}");
        }
    }
}
