use crate::contract::{Cli, State, UploadResponse, Usage};
use crate::settings::{home_dir, Settings, SettingsStore};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const GETS: [&str; 5] = ["state", "usage", "clis", "side", "recap"];
const POSTS: [&str; 12] = ["say", "approve", "focus", "launch", "chat", "chat/end", "side/action", "side/settings", "notes", "supervise", "supervise/confirm", "stop"];
pub const SIDE_IDS: [&str; 14] = ["mail", "whatsapp", "music", "crypto", "github", "vercel", "stripe", "n8n", "resend", "notion", "calcom", "recap", "notes", "phone"];
const CHAT_TIMEOUT: Duration = Duration::from_secs(125);
const TIMEOUT: Duration = Duration::from_secs(5);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/** Routes that may wait on a headless CLI (chat, supervisor, notes summary, mail triage, connector-backed side data) get the long timeout. */
pub fn timeout_for(what: &str) -> Duration {
    if what.starts_with("chat") || what == "supervise" || what.starts_with("side/") || what == "notes" { CHAT_TIMEOUT } else { TIMEOUT }
}

fn week_ok(w: &str) -> bool {
    let b = w.as_bytes();
    w == "all" || (b.len() == 8 && b[4] == b'-' && b[5] == b'W' && b[..4].iter().chain(&b[6..]).all(u8::is_ascii_digit))
}

/** GET routes: fixed names, `side/<known id>`, and `recap?week=YYYY-Www|all`. */
pub fn get_allowed(what: &str) -> bool {
    if GETS.contains(&what) {
        return true;
    }
    if let Some(id) = what.strip_prefix("side/") {
        return SIDE_IDS.contains(&id);
    }
    what.strip_prefix("recap?week=").is_some_and(week_ok)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApiError {
    pub kind: &'static str,
    pub status: u16,
    pub error: String,
    pub message: String,
}

impl ApiError {
    pub fn new(kind: &'static str, status: u16, error: &str, message: impl Into<String>) -> Self {
        Self { kind, status, error: error.into(), message: message.into() }
    }
}

pub fn endpoint(base: &str, what: &str) -> String {
    format!("{}/api/v1/cuckoo/{}", base.trim_end_matches('/'), what)
}

pub fn token(settings: &Settings) -> Option<String> {
    if let Some(t) = &settings.token {
        return Some(t.clone());
    }
    let path = home_dir()?.join(".config").join("agent-monitor").join("token");
    std::fs::read_to_string(path).ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn http_error(status: u16, body: &str) -> ApiError {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = v["error"].as_str().unwrap_or("host_failed");
    let message = v["message"].as_str().unwrap_or("agent-monitor returned an error");
    ApiError::new("http", status, error, message)
}

fn typed(what: &str, v: Value) -> Result<Value, ApiError> {
    let bad = |e: serde_json::Error| ApiError::new("http", 502, "bad_response", e.to_string());
    let out = match what {
        "state" => serde_json::to_value(serde_json::from_value::<State>(v).map_err(bad)?),
        "usage" => serde_json::to_value(serde_json::from_value::<Usage>(v).map_err(bad)?),
        "clis" => serde_json::to_value(serde_json::from_value::<Vec<Cli>>(v).map_err(bad)?),
        _ => Ok(v),
    };
    out.map_err(bad)
}

async fn call(settings: Settings, what: &str, body: Option<Value>) -> Result<Value, ApiError> {
    let token = token(&settings).ok_or_else(|| ApiError::new("no_token", 401, "unauthorised", "no agent-monitor token found"))?;
    let client = reqwest::Client::builder()
        .timeout(timeout_for(what))
        .build()
        .map_err(|e| ApiError::new("offline", 0, "offline", e.to_string()))?;
    let url = endpoint(&settings.monitor_url, what);
    let req = match &body {
        Some(b) => client.post(url).json(b),
        None => client.get(url),
    };
    let res = req
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| ApiError::new("offline", 0, "offline", e.to_string()))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| ApiError::new("offline", 0, "offline", e.to_string()))?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| ApiError::new("http", 502, "bad_response", e.to_string()))?;
    typed(what, v)
}

/** Posts raw bytes to the upload route; the server owns sanitising, size checks and storage. */
pub async fn upload(settings: Settings, name: &str, bytes: Vec<u8>) -> Result<UploadResponse, ApiError> {
    let token = token(&settings).ok_or_else(|| ApiError::new("no_token", 401, "unauthorised", "no agent-monitor token found"))?;
    let offline = |e: reqwest::Error| ApiError::new("offline", 0, "offline", e.to_string());
    let client = reqwest::Client::builder().timeout(UPLOAD_TIMEOUT).build().map_err(offline)?;
    let res = client
        .post(endpoint(&settings.monitor_url, "upload"))
        .bearer_auth(token)
        .header("X-Cuckoo-Name", name)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(offline)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(offline)?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, &text));
    }
    serde_json::from_str(&text).map_err(|e| ApiError::new("http", 502, "bad_response", e.to_string()))
}

#[tauri::command]
pub async fn cuckoo_get(what: String, store: tauri::State<'_, SettingsStore>) -> Result<Value, ApiError> {
    if !get_allowed(&what) {
        return Err(ApiError::new("http", 400, "bad_request", format!("unknown route {what}")));
    }
    call(store.get(), &what, None).await
}

#[tauri::command]
pub async fn cuckoo_post(what: String, body: Value, store: tauri::State<'_, SettingsStore>) -> Result<Value, ApiError> {
    if !POSTS.contains(&what.as_str()) || !body.is_object() {
        return Err(ApiError::new("http", 400, "bad_request", format!("bad request for {what}")));
    }
    call(store.get(), &what, Some(body)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_endpoints() {
        assert_eq!(endpoint("http://127.0.0.1:5818/", "state"), "http://127.0.0.1:5818/api/v1/cuckoo/state");
    }

    #[test]
    fn chat_routes_pass_through_with_long_timeout() {
        assert!(POSTS.contains(&"chat") && POSTS.contains(&"chat/end"));
        assert_eq!(timeout_for("chat"), Duration::from_secs(125));
        assert_eq!(timeout_for("chat/end"), Duration::from_secs(125));
        assert_eq!(timeout_for("say"), Duration::from_secs(5));
        assert_eq!(endpoint("http://h:1", "chat/end"), "http://h:1/api/v1/cuckoo/chat/end");
    }

    #[test]
    fn side_routes_allowed() {
        for w in ["side", "side/mail", "side/calcom", "recap", "recap?week=all", "recap?week=2026-W47"] {
            assert!(get_allowed(w), "{w}");
        }
        for w in ["side/", "side/../token", "side/mail/x", "recap?week=2026-47", "recap?week=all&x=1", "sidex"] {
            assert!(!get_allowed(w), "{w}");
        }
        for p in ["side/action", "side/settings", "notes"] {
            assert!(POSTS.contains(&p));
        }
        assert_eq!(timeout_for("notes"), CHAT_TIMEOUT);
        assert_eq!(timeout_for("side/notion"), CHAT_TIMEOUT);
        assert_eq!(timeout_for("side"), TIMEOUT);
    }

    #[test]
    fn supervise_and_stop_routes_allowed() {
        for p in ["supervise", "supervise/confirm", "stop"] {
            assert!(POSTS.contains(&p));
        }
        assert_eq!(timeout_for("supervise"), CHAT_TIMEOUT);
        assert_eq!(timeout_for("supervise/confirm"), TIMEOUT);
        assert_eq!(timeout_for("stop"), TIMEOUT);
    }

    #[test]
    fn maps_error_bodies() {
        let e = http_error(409, r#"{"ok":false,"error":"stale","message":"agent changed"}"#);
        assert_eq!((e.status, e.error.as_str(), e.message.as_str()), (409, "stale", "agent changed"));
        assert_eq!(http_error(500, "<html>").error, "host_failed");
    }

    #[test]
    fn settings_token_wins() {
        let s = Settings { token: Some("abc".into()), ..Settings::default() };
        assert_eq!(token(&s).as_deref(), Some("abc"));
    }

    #[test]
    fn typed_rejects_broken_state() {
        assert!(typed("state", serde_json::json!({"v":1})).is_err());
        let f: Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        assert_eq!(typed("state", f["state"].clone()).unwrap(), f["state"]);
    }
}
