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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub agent_id: String,
    pub codename: Option<String>,
    pub text: String,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub v: u32,
    pub ts: i64,
    pub agents: Vec<Agent>,
    pub approvals: Vec<Approval>,
    pub replies: Vec<Reply>,
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
    fn unknown_state_falls_back() {
        let a: AgentState = serde_json::from_str("\"sleeping\"").unwrap();
        assert_eq!(a, AgentState::Unknown);
    }
}
