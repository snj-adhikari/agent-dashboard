use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Working,
    Waiting,
    Done,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub codename: Option<String>,
    pub colour: Option<String>,
    pub state: AgentState,
    pub host: String,
    pub terminal_app: Option<String>,
    pub scope: Option<String>,
    pub space: String,
    pub is_main: bool,
    pub cwd: String,
    pub branch: Option<String>,
    pub last_line: Option<String>,
    pub cli: Option<String>,
    pub can_send: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_active_at: Option<i64>,
    /// Absent means true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub can_focus: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cmux_workspace: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalKind {
    Plan,
    Question,
    #[serde(other)]
    Permission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplyKind {
    Ask,
    Summary,
    #[serde(other)]
    Reply,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalOption {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub agent_id: String,
    pub tool: String,
    pub command: String,
    pub options: Vec<ApprovalOption>,
    pub received_at: i64,
    pub screen_hash: String,
    /// Absent means `Permission`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ApprovalKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub agent_id: String,
    pub codename: Option<String>,
    pub text: String,
    pub at: i64,
    /// Absent means `Reply`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ReplyKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub v: u32,
    pub ts: i64,
    pub agents: Vec<Agent>,
    pub approvals: Vec<Approval>,
    pub replies: Vec<Reply>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub music: Option<Music>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Music {
    pub player: String,
    pub playing: bool,
    pub title: String,
    pub artist: Option<String>,
    pub duration_ms: Option<i64>,
    pub position_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    pub five_hour: Option<f64>,
    pub seven_day: Option<f64>,
    pub resets_at: Option<i64>,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub claude: ClaudeUsage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SignedIn {
    Known(bool),
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cli {
    pub cli: String,
    pub path: String,
    pub version: Option<String>,
    pub signed_in: SignedIn,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub cli: String,
    pub text: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub ok: bool,
    pub conversation_id: String,
    pub cli: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEndRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub ok: bool,
    pub upload_id: String,
    pub name: String,
    pub bytes: i64,
    pub mime: String,
}

/// Provider ids stay strings so a provider added server-side never breaks decoding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideProvider {
    pub id: String,
    pub available: bool,
    pub enabled: bool,
    pub via: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Holding {
    pub symbol: String,
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideSettings {
    pub enabled: std::collections::BTreeMap<String, bool>,
    pub holdings: Vec<Holding>,
    pub currency: String,
    pub hide_projects: bool,
    pub phone_push: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideSettingsRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<std::collections::BTreeMap<String, bool>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holdings: Option<Vec<Holding>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_projects: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone_push: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideResponse {
    pub ok: bool,
    pub providers: Vec<SideProvider>,
    pub settings: SideSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideItem {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub value: Option<String>,
    pub url: Option<String>,
    pub tone: Option<String>,
    pub group: Option<String>,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideDataResponse {
    pub ok: bool,
    pub id: String,
    pub updated_at: i64,
    pub items: Vec<SideItem>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideActionRequest {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub item_id: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SideActionResponse {
    pub ok: bool,
    pub result: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CliCount {
    pub cli: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapResponse {
    pub ok: bool,
    pub week: String,
    pub sessions: i64,
    pub approvals: i64,
    pub finishes: i64,
    pub errors: i64,
    pub by_cli: Vec<CliCount>,
    pub top_projects: Option<Vec<ProjectCount>>,
    pub active_days: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotesRequest {
    pub title: String,
    pub transcript: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesResponse {
    pub ok: bool,
    pub note_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseRequest {
    pub text: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub cli: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseConfirmRequest {
    pub confirm_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRequest {
    pub agent_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseTarget {
    pub agent_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisePending {
    pub confirm_id: String,
    pub summary: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseResult {
    pub agent_id: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// `intent` stays a string so an intent added server-side never breaks decoding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuperviseResponse {
    pub ok: bool,
    pub conversation_id: String,
    pub intent: String,
    pub text: String,
    pub targets: Vec<SuperviseTarget>,
    pub pending: Option<SupervisePending>,
    pub results: Vec<SuperviseResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopResponse {
    pub ok: bool,
    pub relay_key: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        state: State,
        usage: Usage,
        clis: Vec<Cli>,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../contract/fixture.json")).expect("fixture decodes")
    }

    #[test]
    fn decodes_state() {
        let s = fixture().state;
        assert_eq!(s.v, 1);
        let main = &s.agents[0];
        assert!(main.is_main && main.can_send);
        assert_eq!(main.state, AgentState::Working);
        assert_eq!(main.codename.as_deref(), Some("eon"));
        let bare = &s.agents[1];
        assert_eq!(bare.host, "bare");
        assert!(!bare.can_send && bare.codename.is_none());
        assert_eq!(s.approvals[0].options.len(), 3);
        assert_eq!(s.replies[0].agent_id, main.id);
    }

    #[test]
    fn decodes_usage_and_clis() {
        let f = fixture();
        assert_eq!(f.usage.claude.five_hour, Some(42.0));
        assert_eq!(f.clis[0].signed_in, SignedIn::Other("unknown".into()));
    }

    #[test]
    fn round_trips_wire_keys() {
        let s = fixture().state;
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["agents"][0]["isMain"], true);
        assert_eq!(v["agents"][0]["terminalApp"], "cmux");
        assert_eq!(v["approvals"][0]["screenHash"], "fedcba9876543210");
    }

    #[test]
    fn fixture_decodes() {
        let raw: serde_json::Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        let f = fixture();
        let main = &f.state.agents[0];
        assert_eq!(main.host_app.as_deref(), Some("cmux"));
        assert_eq!((main.pid, main.last_active_at), (Some(4141), Some(1763429990000)));
        assert!(main.session_id.is_some() && main.can_focus == Some(true));
        let bare = &f.state.agents[1];
        assert!(bare.host_app.is_none() && bare.pid.is_none() && bare.can_focus.is_none(), "absent fields stay absent");
        assert_eq!(f.state.approvals[0].kind, Some(ApprovalKind::Permission));
        assert_eq!(f.state.approvals[1].kind, Some(ApprovalKind::Plan));
        assert_eq!(f.state.replies[0].kind, None);
        assert_eq!((f.state.replies[1].kind, f.state.replies[1].from.as_deref()), (Some(ReplyKind::Ask), Some("hopper")));
        assert!(f.clis[0].chat.is_none() && f.clis[1].chat == Some(true) && f.clis[1].signed_in == SignedIn::Known(true));
        assert_eq!(serde_json::to_value(&f.state).unwrap(), raw["state"], "state round-trips unchanged");
        let req: ChatRequest = serde_json::from_value(raw["requests"]["chat"].clone()).unwrap();
        assert!(req.conversation_id.is_none());
        let res: ChatResponse = serde_json::from_value(raw["responses"]["chat"].clone()).unwrap();
        assert_eq!(res.conversation_id, "c-0001");
        let end: ChatEndRequest = serde_json::from_value(raw["requests"]["chatEnd"].clone()).unwrap();
        assert_eq!(end.conversation_id, res.conversation_id);
    }

    fn decode<T: serde::de::DeserializeOwned>(v: &serde_json::Value) -> T {
        serde_json::from_value(v.clone()).expect("addendum object decodes")
    }

    #[test]
    fn fixture_decodes_addendum() {
        let raw: serde_json::Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        let f = fixture();
        assert_eq!(f.state.agents[0].cmux_workspace.as_deref(), Some("0A0B0C0D-0000-4000-8000-000000000001"));
        assert!(f.state.agents[1].cmux_workspace.is_none());
        let music = f.state.music.as_ref().expect("music");
        assert!(music.playing && music.artist.is_none() && music.duration_ms == Some(215000));
        let chat: ChatRequest = decode(&raw["requests"]["chat"]);
        assert_eq!(chat.attachments.as_deref(), Some(&["u-0001".to_string()][..]));
        let up: UploadResponse = decode(&raw["responses"]["upload"]);
        assert_eq!(up.upload_id, "u-0001");
        let side: SideResponse = decode(&raw["responses"]["side"]);
        assert_eq!(side.settings.currency, "AUD");
        assert_eq!(side.providers[1].reason.as_deref(), Some("needs_key"));
        let data: SideDataResponse = decode(&raw["responses"]["sideData"]);
        assert_eq!(data.items[0].group.as_deref(), Some("reply"));
        let act: SideActionRequest = decode(&raw["requests"]["sideAction"]);
        assert_eq!(act.action, "draft");
        let _: SideActionResponse = decode(&raw["responses"]["sideAction"]);
        let partial: SideSettingsRequest = decode(&raw["requests"]["sideSettings"]);
        assert!(partial.currency.is_none() && partial.hide_projects == Some(true));
        let recap: RecapResponse = decode(&raw["responses"]["recap"]);
        assert!(recap.top_projects.is_none() && recap.by_cli.len() == 2);
        let _: NotesRequest = decode(&raw["requests"]["notes"]);
        let notes: NotesResponse = decode(&raw["responses"]["notes"]);
        assert_eq!(notes.note_id, "n-0001");
    }

    #[test]
    fn pre_addendum_fixture_decodes() {
        let mut v: serde_json::Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        v["state"].as_object_mut().unwrap().remove("music");
        v["state"]["agents"][0].as_object_mut().unwrap().remove("cmuxWorkspace");
        let s: State = serde_json::from_value(v["state"].clone()).expect("old state decodes");
        assert!(s.music.is_none() && s.agents[0].cmux_workspace.is_none());
        assert_eq!(serde_json::to_value(&s).unwrap(), v["state"], "old state round-trips unchanged");
    }

    #[test]
    fn fixture_decodes_supervise() {
        let raw: serde_json::Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        let req: SuperviseRequest = decode(&raw["requests"]["supervise"]);
        assert!(req.conversation_id.is_none() && req.cli.is_none());
        let res: SuperviseResponse = decode(&raw["responses"]["supervise"]);
        assert_eq!((res.intent.as_str(), res.targets.len()), ("send", 2));
        let pending = res.pending.expect("pending");
        assert_eq!((pending.confirm_id.as_str(), pending.expires_at), ("k-0001", 1763430120000));
        let confirm: SuperviseConfirmRequest = decode(&raw["requests"]["superviseConfirm"]);
        assert_eq!((confirm.confirm_id.as_str(), confirm.cancel), ("k-0001", Some(false)));
        let done: SuperviseResponse = decode(&raw["responses"]["superviseConfirm"]);
        assert!(done.pending.is_none() && done.results[0].ok && done.results[1].error.as_deref() == Some("stale"));
        let stop: StopRequest = decode(&raw["requests"]["stop"]);
        let stopped: StopResponse = decode(&raw["responses"]["stop"]);
        assert_eq!((stop.agent_id.as_str(), stopped.relay_key.as_str()), ("herdr:main:w1:p2", "main-w1_p2"));
        let bare: SuperviseRequest = serde_json::from_str(r#"{"text":"hi"}"#).unwrap();
        assert!(bare.conversation_id.is_none() && bare.cli.is_none());
        let odd: SuperviseResponse = serde_json::from_value(serde_json::json!({"ok":true,"conversationId":"s","intent":"teleport","text":"","targets":[],"pending":null,"results":[]})).unwrap();
        assert_eq!(odd.intent, "teleport");
    }

    #[test]
    fn unknown_kind_falls_back() {
        let a: ApprovalKind = serde_json::from_str("\"brand_new\"").unwrap();
        let r: ReplyKind = serde_json::from_str("\"brand_new\"").unwrap();
        assert_eq!((a, r), (ApprovalKind::Permission, ReplyKind::Reply));
        let mut v: serde_json::Value = serde_json::from_str(include_str!("../../../contract/fixture.json")).unwrap();
        v["state"]["approvals"][1]["kind"] = "brand_new".into();
        v["state"]["replies"][1]["kind"] = "brand_new".into();
        let s: State = serde_json::from_value(v["state"].clone()).expect("state still decodes");
        assert_eq!(s.approvals[1].kind, Some(ApprovalKind::Permission));
        assert_eq!(s.replies[1].kind, Some(ReplyKind::Reply));
    }

    #[test]
    fn unknown_state_falls_back() {
        let a: AgentState = serde_json::from_str("\"sleeping\"").unwrap();
        assert_eq!(a, AgentState::Unknown);
    }
}
