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
  hostApp?: string | null;
  pid?: number | null;
  sessionId?: string | null;
  lastActiveAt?: number | null;
  canFocus?: boolean;
  cmuxWorkspace?: string | null;
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
  kind?: ApprovalKind;
}

export type ApprovalKind = 'permission' | 'plan' | 'question';
export type ReplyKind = 'reply' | 'ask' | 'summary';

export interface Reply { id: string; agentId: string; codename: string | null; text: string; at: number; kind?: ReplyKind; from?: string | null }

export interface Music { player: 'music' | 'spotify'; playing: boolean; title: string; artist: string | null; durationMs: number | null; positionMs: number | null }

export interface CuckooState { v: 1; ts: number; agents: Agent[]; approvals: Approval[]; replies: Reply[]; music?: Music | null }

export interface Usage {
  claude: { fiveHour: number | null; sevenDay: number | null; resetsAt: number | null; stale: boolean };
}

export interface Cli { cli: string; path: string; version: string | null; signedIn: boolean | 'unknown'; chat?: boolean }

export type FocusVia = 'cmux' | 'herdr-app' | 'herdr' | 'app' | null;
export interface FocusResponse { ok: boolean; focused: boolean; via?: FocusVia }

export interface ChatRequest { cli: string; text: string; conversationId?: string | null; attachments?: string[] }
export interface ChatResponse { ok: true; conversationId: string; cli: string; text: string }
export interface ChatEndRequest { conversationId: string }
export interface ChatEndResponse { ok: true }

export interface UploadResponse { ok: true; uploadId: string; name: string; bytes: number; mime: string }

export type SideId = 'mail' | 'whatsapp' | 'music' | 'crypto' | 'github' | 'vercel' | 'stripe' | 'n8n' | 'resend' | 'notion' | 'calcom' | 'recap' | 'notes' | 'phone';
export type SideVia = 'cli' | 'applescript' | 'mcp' | 'local' | 'web';
export type SideReason = 'not_installed' | 'signed_out' | 'no_permission' | 'needs_key' | 'unsupported_os' | 'disabled';
export interface SideProvider { id: SideId; available: boolean; enabled: boolean; via: SideVia | null; reason: SideReason | null }
export interface Holding { symbol: string; amount: number }
export interface SideSettings { enabled: Record<SideId, boolean>; holdings: Holding[]; currency: string; hideProjects: boolean; phonePush: boolean }
export interface SideResponse { ok: true; providers: SideProvider[]; settings: SideSettings }
export interface SideItem { id: string; title: string; subtitle: string | null; value: string | null; url: string | null; tone: 'ok' | 'warn' | 'error' | null; group: string | null; actions: string[] }
export interface SideDataResponse { ok: true; id: SideId; updatedAt: number; items: SideItem[]; summary: string | null }
export interface SideActionRequest { id: SideId; action: string; itemId?: string | null; text?: string | null }
export interface SideActionResponse { ok: true; result: string | null }
export type SideSettingsRequest = Partial<SideSettings>;
export interface RecapResponse { ok: true; week: string; sessions: number; approvals: number; finishes: number; errors: number; byCli: { cli: string; count: number }[]; topProjects: { name: string; count: number }[] | null; activeDays: number }
export interface NotesRequest { title: string; transcript: string }
export interface NotesResponse { ok: true; noteId: string; summary: string }

export type SuperviseIntent = 'send' | 'status' | 'approve' | 'deny' | 'chat' | 'unclear';
export interface SuperviseRequest { text: string; conversationId?: string | null; cli?: string | null }
export interface SupervisePending { confirmId: string; summary: string; expiresAt: number }
export interface SuperviseResult { agentId: string; ok: boolean; error: string | null }
export interface SuperviseResponse { ok: true; conversationId: string; intent: SuperviseIntent; text: string; targets: { agentId: string; name: string }[]; pending: SupervisePending | null; results: SuperviseResult[] }
export interface SuperviseConfirmRequest { confirmId: string; cancel?: boolean }
export type SuperviseConfirmResponse = SuperviseResponse;
export interface StopRequest { agentId: string }
export interface StopResponse { ok: true; relayKey: string }

export type Decision = 'allow' | 'always' | 'deny';

export interface ApiError { kind: 'offline' | 'http' | 'no_token'; status: number; error: string; message: string }
