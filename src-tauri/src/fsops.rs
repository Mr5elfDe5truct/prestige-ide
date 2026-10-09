// Files for the agent and the explorer: read, write, list, glob and grep, respecting .gitignore.
use globset::{GlobBuilder, GlobMatcher};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_READ: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[derive(Serialize)]
pub struct GrepHit {
    path: String,
    line: usize,
    text: String,
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[tauri::command(async)]
pub fn fs_read(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} is a directory"));
    }
    if meta.len() > MAX_READ {
        return Err(format!("{path} is {} MB, too large to read", meta.len() / 1_048_576));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err(format!("{path} looks like a binary file"));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command(async)]
pub fn fs_write(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::write(&path, content).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command(async)]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command(async)]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Err(format!("{path} is a directory; only files can be deleted here"));
    }
    fs::remove_file(p).map_err(|e| format!("{path}: {e}"))
}

/// One level of a folder: folders first, then files, by name. Hides .git and node_modules' noise only by name.
#[tauri::command(async)]
pub fn fs_list(path: String) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = fs::read_dir(&path)
        .map_err(|e| format!("{path}: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() != ".git")
        .map(|e| {
            let meta = e.metadata().ok();
            Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: norm(&e.path()),
                is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                size: meta.map(|m| m.len()).unwrap_or(0),
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn walker(root: &str) -> ignore::Walk {
    WalkBuilder::new(root).hidden(false).git_ignore(true).git_global(false).parents(true).filter_entry(|e| {
        let n = e.file_name();
        n != ".git" && n != "node_modules" && n != "target"
    }).build()
}

fn matcher(pattern: &str) -> Result<GlobMatcher, String> {
    // A bare name like "*.rs" should match at any depth.
    let p = if pattern.contains('/') { pattern.to_string() } else { format!("**/{pattern}") };
    Ok(GlobBuilder::new(&p).literal_separator(true).build().map_err(|e| e.to_string())?.compile_matcher())
}

/// Files under `root` matching a glob, newest first.
#[tauri::command(async)]
pub fn fs_glob(root: String, pattern: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let m = matcher(&pattern)?;
    let base = PathBuf::from(&root);
    let mut hits: Vec<(std::time::SystemTime, String)> = Vec::new();
    for e in walker(&root).filter_map(|e| e.ok()) {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let rel = e.path().strip_prefix(&base).unwrap_or(e.path());
        if m.is_match(rel) {
            let t = e.metadata().ok().and_then(|m| m.modified().ok()).unwrap_or(std::time::UNIX_EPOCH);
            hits.push((t, norm(e.path())));
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(hits.into_iter().take(limit.unwrap_or(200)).map(|h| h.1).collect())
}

/// Lines matching a regex in files under `path` (a folder or one file), optionally only files matching `glob`.
#[tauri::command(async)]
pub fn fs_grep(
    path: String,
    pattern: String,
    glob: Option<String>,
    ignore_case: Option<bool>,
    limit: Option<usize>,
) -> Result<Vec<GrepHit>, String> {
    let re = RegexBuilder::new(&pattern).case_insensitive(ignore_case.unwrap_or(false)).build().map_err(|e| e.to_string())?;
    let m = match glob.as_deref() {
        Some(g) if !g.is_empty() => Some(matcher(g)?),
        _ => None,
    };
    let limit = limit.unwrap_or(300);
    let base = PathBuf::from(&path);
    let mut out = Vec::new();
    let files: Vec<PathBuf> = if base.is_file() {
        vec![base.clone()]
    } else {
        walker(&path)
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.into_path())
            .filter(|p| m.as_ref().map(|m| m.is_match(p.strip_prefix(&base).unwrap_or(p))).unwrap_or(true))
            .collect()
    };
    for f in files {
        if fs::metadata(&f).map(|m| m.len() > MAX_READ).unwrap_or(true) {
            continue;
        }
        let Ok(bytes) = fs::read(&f) else { continue };
        if bytes.iter().take(8000).any(|&b| b == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                let t: String = line.chars().take(300).collect();
                out.push(GrepHit { path: norm(&f), line: i + 1, text: t });
                if out.len() >= limit {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}
