use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Runtime, WebviewWindow};

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
}

#[derive(Default, Clone)]
pub struct HitRect(pub Arc<Mutex<Option<Rect>>>);

#[tauri::command]
pub fn set_hit_rect(rect: Rect, hit: tauri::State<'_, HitRect>) {
    *hit.0.lock().unwrap() = Some(rect);
}

pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;
const NEAR_X: f64 = 200.0;
const NEAR_Y: f64 = 160.0;
const BAND: f64 = 120.0;

/** Centres the fixed panel on the primary screen's top edge, in global logical points so mixed-DPI screens line up. */
pub fn place<R: Runtime>(win: &WebviewWindow<R>) {
    let mon = win.primary_monitor().ok().flatten().or_else(|| win.current_monitor().ok().flatten());
    let Some(mon) = mon else { return };
    let (x, y) = top_centre(mon.position().x as f64, mon.position().y as f64, mon.size().width as f64, mon.scale_factor());
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

pub fn top_centre(mon_x: f64, mon_y: f64, mon_w: f64, scale: f64) -> (f64, f64) {
    ((mon_x + (mon_w - PANEL_W * scale) / 2.0) / scale, mon_y / scale)
}

pub fn poll_interval(rect: Option<Rect>, px: f64, py: f64) -> Duration {
    let near = rect.is_some_and(|r| Rect { x: r.x - NEAR_X, y: r.y - NEAR_Y, w: r.w + 2.0 * NEAR_X, h: r.h + 2.0 * NEAR_Y }.contains(px, py));
    let band = Rect { x: -BAND, y: -BAND, w: PANEL_W + 2.0 * BAND, h: PANEL_H + 2.0 * BAND };
    Duration::from_millis(if near { 16 } else if band.contains(px, py) { 50 } else { 125 })
}

/** Polls the cursor so the transparent panel only takes clicks over the island; 60 Hz near it, 20 Hz round the panel, 8 Hz elsewhere. */
pub fn start_cursor_poll<R: Runtime>(win: WebviewWindow<R>, hit: HitRect) {
    let _ = win.set_ignore_cursor_events(true);
    std::thread::spawn(move || {
        let mut inside = false;
        loop {
            let rect = hit.0.lock().ok().and_then(|r| *r);
            let cursor = local_cursor(&win);
            let now = matches!((rect, cursor), (Some(r), Some((x, y))) if r.contains(x, y));
            if now != inside {
                inside = now;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = win.emit("island-hover", inside);
            }
            let (x, y) = cursor.unwrap_or((f64::MAX, f64::MAX));
            std::thread::sleep(poll_interval(rect, x, y));
        }
    });
}

fn local_cursor<R: Runtime>(win: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let cursor = win.cursor_position().ok()?;
    let origin = win.inner_position().ok()?;
    let scale = win.scale_factor().ok()?;
    Some(((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale))
}

#[tauri::command]
pub fn reduce_motion() -> bool {
    #[cfg(target_os = "macos")]
    return objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion();
    #[cfg(not(target_os = "macos"))]
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_edges() {
        let r = Rect { x: 10.0, y: 0.0, w: 100.0, h: 30.0 };
        assert!(r.contains(10.0, 0.0));
        assert!(r.contains(109.9, 29.9));
        assert!(!r.contains(110.0, 10.0));
        assert!(!r.contains(50.0, 30.0));
        assert!(!r.contains(9.9, 5.0));
    }

    #[test]
    fn hit_rect_poll_rates() {
        let r = Some(Rect { x: 216.0, y: 0.0, w: 288.0, h: 32.0 });
        assert_eq!(poll_interval(r, 300.0, 10.0), Duration::from_millis(16));
        assert_eq!(poll_interval(r, 216.0 - 199.0, 191.0), Duration::from_millis(16));
        assert_eq!(poll_interval(r, 5.0, 300.0), Duration::from_millis(50));
        assert_eq!(poll_interval(r, -119.0, 0.0), Duration::from_millis(50));
        assert_eq!(poll_interval(r, -121.0, 0.0), Duration::from_millis(125));
        assert_eq!(poll_interval(None, 300.0, 10.0), Duration::from_millis(50));
        assert_eq!(poll_interval(r, f64::MAX, f64::MAX), Duration::from_millis(125));
    }

    #[test]
    fn hit_rect_place_mixed_dpi() {
        assert_eq!(top_centre(0.0, 0.0, 3024.0, 2.0), (396.0, 0.0));
        assert_eq!(top_centre(3024.0, 0.0, 1920.0, 1.0), (3624.0, 0.0));
        assert_eq!(top_centre(-2560.0, -1440.0, 2560.0, 1.0), (-1640.0, -1440.0));
    }
}
