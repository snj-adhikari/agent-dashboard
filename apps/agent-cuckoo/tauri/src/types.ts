export type AgentState = 'working' | 'waiting' | 'done' | 'unknown';
export type Host = 'herdr' | 'herdr-app' | 'cmux' | 'tmux' | 'bare';

export interface Agent {
  id: string;
  name: string;
  codename: string | null;
  colour: string | null;
  state: AgentState;
  host: Host;
  terminalApp: string | null;
  scope: string | null;
  space: string;
  isMain: boolean;
  cwd: string;
  branch: string | null;
  lastLine: string | null;
  cli: string | null;
  canSend: boolean;
}

export interface ApprovalOption { key: string; label: string }

export interface Approval {
  id: string;
  agentId: string;
  tool: string;
  command: string;
  options: ApprovalOption[];
  receivedAt: number;
  screenHash: string;
}

export interface Reply { id: string; agentId: string; codename: string | null; text: string; at: number }

export interface CuckooState { v: 1; ts: number; agents: Agent[]; approvals: Approval[]; replies: Reply[] }

export interface Usage {
  claude: { fiveHour: number | null; sevenDay: number | null; resetsAt: number | null; stale: boolean };
}

export interface Cli { cli: string; path: string; version: string | null; signedIn: boolean | 'unknown' }

export type Decision = 'allow' | 'always' | 'deny';

export interface ApiError { kind: 'offline' | 'http' | 'no_token'; status: number; error: string; message: string }
