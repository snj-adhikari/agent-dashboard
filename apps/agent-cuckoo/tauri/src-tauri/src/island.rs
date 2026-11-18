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

pub fn place<R: Runtime>(win: &WebviewWindow<R>) {
    let Ok(Some(mon)) = win.current_monitor().or_else(|_| win.primary_monitor()) else { return };
    let Ok(size) = win.outer_size() else { return };
    let x = mon.position().x + (mon.size().width as i32 - size.width as i32) / 2;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, mon.position().y));
}

/** Polls the cursor so the transparent window only takes clicks over the island; everywhere else passes through. */
pub fn start_cursor_poll<R: Runtime>(win: WebviewWindow<R>, hit: HitRect) {
    let _ = win.set_ignore_cursor_events(true);
    std::thread::spawn(move || {
        let mut inside = false;
        loop {
            let now = cursor_inside(&win, &hit).unwrap_or(false);
            if now != inside {
                inside = now;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = win.emit("island-hover", inside);
            }
            std::thread::sleep(Duration::from_millis(if inside { 40 } else { 120 }));
        }
    });
}

fn cursor_inside<R: Runtime>(win: &WebviewWindow<R>, hit: &HitRect) -> Option<bool> {
    let rect = (*hit.0.lock().ok()?)?;
    let cursor = win.cursor_position().ok()?;
    let origin = win.inner_position().ok()?;
    let scale = win.scale_factor().ok()?;
    Some(rect.contains((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale))
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
}
