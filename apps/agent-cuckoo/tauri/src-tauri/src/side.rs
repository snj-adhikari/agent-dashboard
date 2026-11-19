use crate::api::{self, ApiError};
use crate::contract::UploadResponse;
use crate::island::{self, HitRect, Rect};
use crate::settings::{home_dir, SettingsStore};
use std::path::{Path, PathBuf};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};

pub const MAX_UPLOAD: u64 = 25 * 1024 * 1024;
pub const MASCOT_LABEL: &str = "desktop-mascot";
const MASCOT_BODY: Rect = Rect { x: 18.0, y: 18.0, w: 84.0, h: 84.0 };
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Capture {
    Region,
    Full,
}

/** File name safe for an HTTP header and a single path segment: basename only, printable ASCII, max 120 chars. */
pub fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .take(120)
        .collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() { "file".into() } else { clean }
}

/** Checks a picked file before upload: must exist, be a regular file and fit the server's 25 MB cap. */
pub fn check_upload_path(path: &Path) -> Result<String, ApiError> {
    let meta = std::fs::metadata(path).map_err(|e| ApiError::new("local", 404, "not_found", e.to_string()))?;
    if !meta.is_file() {
        return Err(ApiError::new("local", 400, "bad_request", "not a regular file"));
    }
    if meta.len() > MAX_UPLOAD {
        return Err(ApiError::new("local", 413, "too_large", "file is over 25 MB"));
    }
    Ok(safe_name(&path.to_string_lossy()))
}

#[tauri::command]
pub async fn upload_path(path: String, store: tauri::State<'_, SettingsStore>) -> Result<UploadResponse, ApiError> {
    let path = PathBuf::from(path);
    let name = check_upload_path(&path)?;
    let bytes = std::fs::read(&path).map_err(|e| ApiError::new("local", 500, "host_failed", e.to_string()))?;
    api::upload(store.get(), &name, bytes).await
}

pub fn capture_args(mode: Capture, out: &Path) -> Vec<String> {
    let flags: &[&str] = match mode {
        Capture::Region => &["-i", "-x"],
        Capture::Full => &["-m", "-x"],
    };
    flags.iter().map(|f| f.to_string()).chain([out.to_string_lossy().into_owned()]).collect()
}

static CAPTURE_SEQ: AtomicU64 = AtomicU64::new(0);

/** Fresh 0700 directory per capture; non-recursive create fails rather than reuse a path someone else made. */
pub fn capture_dir(base: &Path) -> Result<PathBuf, ApiError> {
    let ns = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut last = None;
    for _ in 0..8 {
        let n = CAPTURE_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = base.join(format!("agent-cuckoo-capture-{}-{ns:x}-{n}", std::process::id()));
        let mut b = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
        match b.create(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) => last = Some(e),
        }
    }
    Err(ApiError::new("local", 500, "host_failed", last.map(|e| e.to_string()).unwrap_or_default()))
}

#[cfg(target_os = "macos")]
fn shoot(mode: Capture, out: &Path) -> Result<(), ApiError> {
    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(capture_args(mode, out))
        .status()
        .map_err(|e| ApiError::new("local", 500, "host_failed", e.to_string()))?;
    if !status.success() && out.exists() {
        return Err(ApiError::new("local", 500, "host_failed", "screencapture failed"));
    }
    Ok(())
}

/** No interactive region picker off macOS: both modes grab the primary monitor. */
#[cfg(not(target_os = "macos"))]
fn shoot(_mode: Capture, out: &Path) -> Result<(), ApiError> {
    let fail = |e: String| ApiError::new("local", 500, "host_failed", e);
    let monitors = xcap::Monitor::all().map_err(|e| fail(e.to_string()))?;
    let mon = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(monitors.first())
        .ok_or_else(|| fail("no monitor".into()))?;
    mon.capture_image().map_err(|e| fail(e.to_string()))?.save(out).map_err(|e| fail(e.to_string()))
}

/** Captures to a private temp file, uploads it and deletes it; `None` when the user cancels the picker. */
pub async fn capture_upload(store: &SettingsStore, mode: Capture) -> Result<Option<UploadResponse>, ApiError> {
    let dir = capture_dir(&std::env::temp_dir())?;
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = format!("screenshot-{ms}.png");
    let out = dir.join(&name);
    let target = out.clone();
    let shot = tauri::async_runtime::spawn_blocking(move || shoot(mode, &target)).await;
    let bytes = std::fs::read(&out);
    let _ = std::fs::remove_dir_all(&dir);
    shot.map_err(|e| ApiError::new("local", 500, "host_failed", e.to_string()))??;
    let Ok(bytes) = bytes else { return Ok(None) };
    api::upload(store.get(), &name, bytes).await.map(Some)
}

#[tauri::command]
pub async fn capture_region(store: tauri::State<'_, SettingsStore>) -> Result<Option<UploadResponse>, ApiError> {
    capture_upload(&store, Capture::Region).await
}

pub const OPEN_CHAT_SHORTCUT: &str = "Control+Alt+KeyC";
pub const CAPTURE_SHORTCUTS: [&str; 3] = ["CommandOrControl+Shift+S", "CommandOrControl+Shift+2", OPEN_CHAT_SHORTCUT];
pub const STARTUP_SHORTCUTS: [&str; 0] = [];

pub fn capture_shortcuts(enabled: bool) -> &'static [&'static str] {
    if enabled { &CAPTURE_SHORTCUTS } else { &[] }
}

/** Handler only; nothing is grabbed at startup because Cmd/Ctrl-Shift-S is Save As in most apps. Region = S, full screen = 2 (results reach the island as a `capture` event); Ctrl-Alt-C emits `open-chat`. */
pub fn shortcuts<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts(STARTUP_SHORTCUTS)
        .expect("valid startup shortcuts")
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if shortcut.key == Code::KeyC {
                if let Some(win) = app.get_webview_window("island") {
                    let _ = win.set_focus();
                }
                let _ = app.emit_to("island", "open-chat", ());
                return;
            }
            let mode = if shortcut.key == Code::Digit2 { Capture::Full } else { Capture::Region };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let store = app.state::<SettingsStore>();
                let res = capture_upload(&store, mode).await;
                let _ = app.emit_to("island", "capture", res);
            });
        })
        .build()
}

/** Async so the plugin's main-thread dispatch never runs on the main thread itself. */
#[tauri::command]
pub async fn set_capture_shortcuts<R: Runtime>(enabled: bool, app: AppHandle<R>) -> Result<(), String> {
    let gs = app.global_shortcut();
    for s in CAPTURE_SHORTCUTS {
        if gs.is_registered(s) {
            gs.unregister(s).map_err(|e| e.to_string())?;
        }
    }
    gs.register_multiple(capture_shortcuts(enabled).iter().copied()).map_err(|e| e.to_string())
}

fn mascot_pos_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("desktop-mascot.json"))
}

pub fn parse_pos(raw: &str) -> Option<(i32, i32)> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    Some((v["x"].as_i64()? as i32, v["y"].as_i64()? as i32))
}

const SETTLE: std::time::Duration = std::time::Duration::from_millis(400);

/** A drag ends with the pointer still on the mascot; a flight is driven by `setPosition` with the pointer elsewhere, and its island stop sits on the monitor's top edge. */
pub fn save_after_move(cursor_inside: bool, y: i32, monitor_top: i32) -> bool {
    cursor_inside && y > monitor_top
}

fn cursor_inside<R: Runtime>(w: &tauri::WebviewWindow<R>) -> bool {
    let (Ok(c), Ok(o), Ok(s)) = (w.cursor_position(), w.outer_position(), w.outer_size()) else { return false };
    let (x, y) = (c.x - o.x as f64, c.y - o.y as f64);
    x >= 0.0 && y >= 0.0 && x < s.width as f64 && y < s.height as f64
}

static MASCOT_READY: AtomicBool = AtomicBool::new(false);

/** First show restores the saved position, persists moves and makes only the body clickable. */
fn prepare_mascot<R: Runtime>(app: &AppHandle<R>, win: &tauri::WebviewWindow<R>) {
    if MASCOT_READY.swap(true, Ordering::SeqCst) {
        return;
    }
    let file = mascot_pos_file(app);
    if let Some((x, y)) = file.as_ref().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|r| parse_pos(&r)) {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
    let seq = Arc::new(AtomicU64::new(0));
    let w = win.clone();
    win.on_window_event(move |e| {
        let (WindowEvent::Moved(p), Some(f)) = (e, &file) else { return };
        let (p, f, w, seq) = (*p, f.clone(), w.clone(), seq.clone());
        let n = seq.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            std::thread::sleep(SETTLE);
            if seq.load(Ordering::SeqCst) != n {
                return;
            }
            let top = w.current_monitor().ok().flatten().map(|m| m.position().y).unwrap_or(0);
            if save_after_move(cursor_inside(&w), p.y, top) {
                let _ = f.parent().map(std::fs::create_dir_all);
                let _ = std::fs::write(&f, serde_json::json!({ "x": p.x, "y": p.y }).to_string());
            }
        });
    });
    island::start_cursor_poll(win.clone(), HitRect(Arc::new(Mutex::new(Some(MASCOT_BODY)))));
}

#[tauri::command]
pub fn desktop_mascot<R: Runtime>(show: bool, app: AppHandle<R>) -> Result<(), String> {
    let win = app.get_webview_window(MASCOT_LABEL).ok_or("desktop-mascot window missing")?;
    if !show {
        return win.hide().map_err(|e| e.to_string());
    }
    prepare_mascot(&app, &win);
    win.show().map_err(|e| e.to_string())
}

fn png_candidate(dir: &Path, stem: &str, n: u32) -> PathBuf {
    dir.join(if n == 0 { format!("{stem}.png") } else { format!("{stem} ({n}).png") })
}

/** Claims `<dir>/<name>.png` with create_new, moving to ` (n)` on any existing entry, dangling symlinks included. */
pub fn write_png(dir: &Path, bytes: &[u8], name: &str) -> Result<PathBuf, String> {
    if !bytes.starts_with(PNG_MAGIC) {
        return Err("not a PNG".into());
    }
    if bytes.len() as u64 > MAX_UPLOAD {
        return Err("PNG is over 25 MB".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stem = safe_name(name);
    let stem = stem.strip_suffix(".png").unwrap_or(&stem);
    for n in 0..1000 {
        let path = png_candidate(dir, stem, n);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => return f.write_all(bytes).map(|_| path).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("no free file name".into())
}

#[tauri::command]
pub fn save_png(bytes: Vec<u8>, name: String) -> Result<String, String> {
    let dir = home_dir().ok_or("no home directory")?.join("Downloads");
    write_png(&dir, &bytes, &name).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cuckoo-side-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn upload_path_name_is_basename_and_header_safe() {
        assert_eq!(safe_name("/Users/a/Desktop/report final.pdf"), "report final.pdf");
        assert_eq!(safe_name("C:\\x\\y\\..\\notes.txt"), "notes.txt");
        assert_eq!(safe_name("/tmp/résumé\r\n.png"), "r_sum___.png");
        assert_eq!(safe_name("/tmp/.hidden"), "hidden");
        assert_eq!(safe_name("/tmp/"), "file");
        assert_eq!(safe_name(&"a".repeat(300)).len(), 120);
    }

    #[test]
    fn upload_path_rejects_missing_dirs_and_large() {
        let d = tmp("up");
        assert_eq!(check_upload_path(&d.join("nope")).unwrap_err().error, "not_found");
        assert_eq!(check_upload_path(&d).unwrap_err().error, "bad_request");
        let big = d.join("big.bin");
        std::fs::File::create(&big).unwrap().set_len(MAX_UPLOAD + 1).unwrap();
        let e = check_upload_path(&big).unwrap_err();
        assert_eq!((e.status, e.error.as_str()), (413, "too_large"));
        let ok = d.join("ok.txt");
        std::fs::write(&ok, b"hi").unwrap();
        assert_eq!(check_upload_path(&ok).unwrap(), "ok.txt");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn capture_args_region_is_interactive_and_silent() {
        assert_eq!(capture_args(Capture::Region, Path::new("/t/a.png")), ["-i", "-x", "/t/a.png"]);
    }

    #[test]
    fn capture_args_full_is_main_screen_only() {
        assert_eq!(capture_args(Capture::Full, Path::new("/t/b.png")), ["-m", "-x", "/t/b.png"]);
    }

    #[test]
    fn capture_args_path_is_one_argv_item() {
        let args = capture_args(Capture::Region, Path::new("/t/has space; rm -rf.png"));
        assert_eq!(args.last().unwrap(), "/t/has space; rm -rf.png");
        assert_eq!(args.len(), 3);
    }

    #[test]
    fn capture_shortcuts_off_by_default() {
        assert!(STARTUP_SHORTCUTS.is_empty());
        assert!(capture_shortcuts(false).is_empty());
        assert_eq!(capture_shortcuts(true), CAPTURE_SHORTCUTS);
    }

    #[test]
    fn open_chat_shortcut_gated() {
        assert!(!capture_shortcuts(false).contains(&OPEN_CHAT_SHORTCUT));
        assert!(capture_shortcuts(true).contains(&OPEN_CHAT_SHORTCUT));
        assert!(!STARTUP_SHORTCUTS.contains(&OPEN_CHAT_SHORTCUT));
        assert!(!crate::settings::Settings::default().capture_shortcuts);
    }

    #[test]
    fn save_png_checks_magic_and_never_overwrites() {
        let d = tmp("png");
        assert!(write_png(&d, b"GIF89a", "x").is_err());
        let png = [PNG_MAGIC, b"rest"].concat();
        let a = write_png(&d, &png, "recap/../week.png").unwrap();
        let b = write_png(&d, &png, "week").unwrap();
        assert_eq!(a.file_name().unwrap(), "week.png");
        assert_eq!(b.file_name().unwrap(), "week (1).png");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn save_png_skips_dangling_symlink() {
        let d = tmp("link");
        let target = d.join("elsewhere.png");
        std::os::unix::fs::symlink(&target, d.join("week.png")).unwrap();
        let png = [PNG_MAGIC, b"rest"].concat();
        assert_eq!(write_png(&d, &png, "week").unwrap().file_name().unwrap(), "week (1).png");
        assert!(!target.exists());
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn capture_dir_is_fresh_and_private() {
        let base = tmp("cap");
        let a = capture_dir(&base).unwrap();
        let b = capture_dir(&base).unwrap();
        assert_ne!(a, b);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&a).unwrap().permissions().mode() & 0o777, 0o700);
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn desktop_mascot_saves_only_at_drag_end() {
        assert!(save_after_move(true, 400, 0));
        assert!(!save_after_move(false, 400, 0));
        assert!(!save_after_move(true, 0, 0));
        assert!(!save_after_move(true, 25, 25));
    }

    #[test]
    fn desktop_mascot_position_parse() {
        assert_eq!(parse_pos(r#"{"x":-40,"y":900}"#), Some((-40, 900)));
        assert_eq!(parse_pos(r#"{"x":1}"#), None);
        assert_eq!(parse_pos("garbage"), None);
    }
}
