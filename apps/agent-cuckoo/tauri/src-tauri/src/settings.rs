use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const DEFAULT_URL: &str = "http://127.0.0.1:5818";
pub const MAX_RECENTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub monitor_url: String,
    pub token: Option<String>,
    pub sounds: bool,
    pub recents: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { monitor_url: DEFAULT_URL.into(), token: None, sounds: true, recents: Vec::new() }
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
