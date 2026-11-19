use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const DEFAULT_URL: &str = "http://127.0.0.1:5818";
pub const MAX_RECENTS: usize = 10;
pub const DEFAULT_VOLUME: f64 = 0.12;
pub const MAX_VOLUME: f64 = 0.2;
pub const AUTO_CLOSE_SEC: [u32; 3] = [10, 15, 30];
pub const DEFAULT_AUTO_CLOSE_SEC: u32 = 15;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub monitor_url: String,
    pub token: Option<String>,
    pub sounds: bool,
    pub recents: Vec<String>,
    pub open_on_hover: bool,
    pub volume: f64,
    pub auto_close_sec: u32,
    pub outfit: String,
    pub hemisphere: String,
    pub capture_shortcuts: bool,
    pub desktop_mascot: bool,
    pub recap_shown_at: Option<i64>,
    pub whats_new_seen: Option<String>,
    pub island_collapsed: bool,
    pub guide_seen: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            monitor_url: DEFAULT_URL.into(),
            token: None,
            sounds: true,
            recents: Vec::new(),
            open_on_hover: false,
            volume: DEFAULT_VOLUME,
            auto_close_sec: DEFAULT_AUTO_CLOSE_SEC,
            outfit: "auto".into(),
            hemisphere: "south".into(),
            capture_shortcuts: false,
            desktop_mascot: false,
            recap_shown_at: None,
            whats_new_seen: None,
            island_collapsed: false,
            guide_seen: false,
        }
    }
}

impl Settings {
    pub fn parse(raw: &str) -> Self {
        let mut s: Settings = serde_json::from_str(raw).unwrap_or_default();
        s.monitor_url = s.monitor_url.trim().trim_end_matches('/').to_string();
        if !(s.monitor_url.starts_with("http://") || s.monitor_url.starts_with("https://")) {
            s.monitor_url = DEFAULT_URL.into();
        }
        s.token = s.token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        s.volume = if s.volume.is_finite() { s.volume.clamp(0.0, MAX_VOLUME) } else { DEFAULT_VOLUME };
        if !AUTO_CLOSE_SEC.contains(&s.auto_close_sec) {
            s.auto_close_sec = DEFAULT_AUTO_CLOSE_SEC;
        }
        if s.hemisphere != "north" {
            s.hemisphere = "south".into();
        }
        if s.outfit.is_empty() || s.outfit.len() > 32 || !s.outfit.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            s.outfit = "auto".into();
        }
        let recents = std::mem::take(&mut s.recents);
        for r in recents.into_iter().rev() {
            s.push_recent(&r);
        }
        s
    }

    pub fn push_recent(&mut self, dir: &str) {
        let dir = dir.trim();
        if dir.is_empty() || dir == "/" || Some(dir) == home_dir().as_deref().and_then(|h| h.to_str()) {
            return;
        }
        self.recents.retain(|r| r != dir);
        self.recents.insert(0, dir.to_string());
        self.recents.truncate(MAX_RECENTS);
    }
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

pub struct SettingsStore {
    pub path: PathBuf,
    pub current: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let current = std::fs::read_to_string(&path).map(|r| Settings::parse(&r)).unwrap_or_default();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    pub fn save(&self, next: Settings) -> Result<Settings, String> {
        let next = Settings::parse(&serde_json::to_string(&next).map_err(|e| e.to_string())?);
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&next).unwrap()).map_err(|e| e.to_string())?;
        *self.current.lock().unwrap() = next.clone();
        Ok(next)
    }
}

#[tauri::command]
pub fn get_settings(store: tauri::State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn save_settings(settings: Settings, store: tauri::State<'_, SettingsStore>) -> Result<Settings, String> {
    store.save(settings)
}

#[tauri::command]
pub fn add_recent(dir: String, store: tauri::State<'_, SettingsStore>) -> Result<Settings, String> {
    let mut s = store.get();
    s.push_recent(&dir);
    store.save(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_on_bad_json() {
        assert_eq!(Settings::parse("not json"), Settings::default());
    }

    #[test]
    fn sanitises_url_and_token() {
        let s = Settings::parse(r#"{"monitorUrl":" http://box:5818/ ","token":"  "}"#);
        assert_eq!(s.monitor_url, "http://box:5818");
        assert_eq!(s.token, None);
        assert_eq!(Settings::parse(r#"{"monitorUrl":"file:///x"}"#).monitor_url, DEFAULT_URL);
    }

    #[test]
    fn recents_dedupe_cap_and_skip_root() {
        let mut s = Settings::default();
        for i in 0..12 {
            s.push_recent(&format!("/p/{i}"));
        }
        s.push_recent("/p/5");
        s.push_recent("/");
        assert_eq!(s.recents.len(), MAX_RECENTS);
        assert_eq!(s.recents[0], "/p/5");
        assert_eq!(s.recents.iter().filter(|r| *r == "/p/5").count(), 1);
    }

    #[test]
    fn old_file_without_new_fields_loads_defaults() {
        let s = Settings::parse(r#"{"monitorUrl":"http://box:5818","token":null,"sounds":false,"recents":["/p/a"]}"#);
        assert!(!s.sounds);
        assert_eq!(s.recents, vec!["/p/a".to_string()]);
        assert!(!s.open_on_hover);
        assert_eq!(s.volume, DEFAULT_VOLUME);
        assert_eq!(s.auto_close_sec, DEFAULT_AUTO_CLOSE_SEC);
        assert_eq!((s.outfit.as_str(), s.hemisphere.as_str()), ("auto", "south"));
        assert!(!s.capture_shortcuts && !s.desktop_mascot);
        assert_eq!((s.recap_shown_at, s.whats_new_seen), (None, None));
    }

    #[test]
    fn side_fields_round_trip_and_sanitise() {
        let s = Settings::parse(r#"{"outfit":"party-hat","hemisphere":"north","captureShortcuts":true,"desktopMascot":true,"recapShownAt":5,"whatsNewSeen":"0.1.0"}"#);
        assert_eq!((s.outfit.as_str(), s.hemisphere.as_str()), ("party-hat", "north"));
        assert!(s.capture_shortcuts && s.desktop_mascot);
        assert_eq!((s.recap_shown_at, s.whats_new_seen.as_deref()), (Some(5), Some("0.1.0")));
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""captureShortcuts":true"#) && json.contains(r#""whatsNewSeen":"0.1.0""#));
        let bad = Settings::parse(r#"{"outfit":"../x","hemisphere":"east"}"#);
        assert_eq!((bad.outfit.as_str(), bad.hemisphere.as_str()), ("auto", "south"));
    }

    #[test]
    fn island_collapsed_defaults_off_and_round_trips() {
        assert!(!Settings::parse(r#"{"sounds":true}"#).island_collapsed);
        let s = Settings::parse(r#"{"islandCollapsed":true}"#);
        assert!(s.island_collapsed);
        assert!(serde_json::to_string(&s).unwrap().contains(r#""islandCollapsed":true"#));
    }

    #[test]
    fn guide_seen_defaults_off_and_round_trips() {
        assert!(!Settings::parse(r#"{"sounds":true}"#).guide_seen);
        let s = Settings::parse(r#"{"guideSeen":true}"#);
        assert!(s.guide_seen);
        assert!(serde_json::to_string(&s).unwrap().contains(r#""guideSeen":true"#));
    }

    #[test]
    fn new_fields_use_ts_wire_names() {
        let s = Settings::parse(r#"{"openOnHover":true,"volume":0.05,"autoCloseSec":30}"#);
        assert!(s.open_on_hover);
        assert_eq!(s.volume, 0.05);
        assert_eq!(s.auto_close_sec, 30);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""openOnHover":true"#) && json.contains(r#""volume":0.05"#) && json.contains(r#""autoCloseSec":30"#));
    }

    #[test]
    fn clamps_volume_and_auto_close() {
        let s = Settings::parse(r#"{"volume":0.9,"autoCloseSec":7}"#);
        assert_eq!(s.volume, MAX_VOLUME);
        assert_eq!(s.auto_close_sec, DEFAULT_AUTO_CLOSE_SEC);
        assert_eq!(Settings::parse(r#"{"volume":-1}"#).volume, 0.0);
    }

    #[test]
    fn save_round_trips_new_fields() {
        let dir = std::env::temp_dir().join(format!("cuckoo-settings-new-{}", std::process::id()));
        let store = SettingsStore::load(dir.join("settings.json"));
        let s = Settings { open_on_hover: true, volume: 0.07, auto_close_sec: 10, ..store.get() };
        store.save(s).unwrap();
        let back = SettingsStore::load(dir.join("settings.json")).get();
        assert!(back.open_on_hover);
        assert_eq!(back.volume, 0.07);
        assert_eq!(back.auto_close_sec, 10);
        let out = store.save(Settings { volume: 5.0, auto_close_sec: 99, ..back }).unwrap();
        assert_eq!((out.volume, out.auto_close_sec), (MAX_VOLUME, DEFAULT_AUTO_CLOSE_SEC));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_round_trips() {
        let dir = std::env::temp_dir().join(format!("cuckoo-settings-{}", std::process::id()));
        let store = SettingsStore::load(dir.join("settings.json"));
        let mut s = store.get();
        s.sounds = false;
        store.save(s).unwrap();
        assert!(!SettingsStore::load(dir.join("settings.json")).get().sounds);
        let _ = std::fs::remove_dir_all(dir);
    }
}
