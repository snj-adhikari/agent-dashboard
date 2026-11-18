use crate::contract::{Cli, State, Usage};
use crate::settings::{home_dir, Settings, SettingsStore};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const GETS: [&str; 3] = ["state", "usage", "clis"];
const POSTS: [&str; 4] = ["say", "approve", "focus", "launch"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApiError {
    pub kind: &'static str,
    pub status: u16,
    pub error: String,
    pub message: String,
}

impl ApiError {
    fn new(kind: &'static str, status: u16, error: &str, message: impl Into<String>) -> Self {
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
        .timeout(Duration::from_secs(5))
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

#[tauri::command]
pub async fn cuckoo_get(what: String, store: tauri::State<'_, SettingsStore>) -> Result<Value, ApiError> {
    if !GETS.contains(&what.as_str()) {
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
