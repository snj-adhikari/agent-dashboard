import Foundation

public enum AgentState: String, Codable, CaseIterable {
    case working, waiting, done, unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgentState(rawValue: raw) ?? .unknown
    }
}

public struct Agent: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var codename: String?
    public var colour: String?
    public var state: AgentState
    public var host: String
    public var terminalApp: String?
    public var scope: String?
    public var space: String
    public var isMain: Bool
    public var cwd: String?
    public var branch: String?
    public var lastLine: String?
    public var cli: String?
    public var canSend: Bool
    public var hostApp: String?
    public var pid: Int?
    public var sessionId: String?
    public var lastActiveAt: Int64?
    /// Absent on the wire means true; read it with `?? true`.
    public var canFocus: Bool?
    public var cmuxWorkspace: String?

    public init(id: String, name: String, codename: String? = nil, colour: String? = nil,
                state: AgentState, host: String = "herdr", terminalApp: String? = nil,
                scope: String? = nil, space: String, isMain: Bool = false, cwd: String? = nil,
                branch: String? = nil, lastLine: String? = nil, cli: String? = nil, canSend: Bool = true,
                hostApp: String? = nil, pid: Int? = nil, sessionId: String? = nil,
                lastActiveAt: Int64? = nil, canFocus: Bool? = nil, cmuxWorkspace: String? = nil) {
        self.id = id; self.name = name; self.codename = codename; self.colour = colour
        self.state = state; self.host = host; self.terminalApp = terminalApp; self.scope = scope
        self.space = space; self.isMain = isMain; self.cwd = cwd; self.branch = branch
        self.lastLine = lastLine; self.cli = cli; self.canSend = canSend
        self.hostApp = hostApp; self.pid = pid; self.sessionId = sessionId
        self.lastActiveAt = lastActiveAt; self.canFocus = canFocus; self.cmuxWorkspace = cmuxWorkspace
    }

    public var label: String { codename.map { "\($0) · \(name)" } ?? name }
}

public struct ApprovalOption: Codable, Equatable {
    public var key: String
    public var label: String
    public init(key: String, label: String) { self.key = key; self.label = label }
}

public struct Approval: Codable, Equatable, Identifiable {
    public var id: String
    public var agentId: String
    public var tool: String
    public var command: String
    public var options: [ApprovalOption]
    public var receivedAt: Double
    public var screenHash: String
    /// Absent on the wire means `.permission`.
    public var kind: ApprovalKind?

    public init(id: String, agentId: String, tool: String = "Bash", command: String = "",
                options: [ApprovalOption] = [], receivedAt: Double, screenHash: String = "",
                kind: ApprovalKind? = nil) {
        self.id = id; self.agentId = agentId; self.tool = tool; self.command = command
        self.options = options; self.receivedAt = receivedAt; self.screenHash = screenHash
        self.kind = kind
    }

    public var isCommitOrPush: Bool {
        command.range(of: #"git\s+(commit|push)"#, options: .regularExpression) != nil
    }

    public var decisions: [Decision] {
        options.count >= 3 ? [.allow, .always, .deny] : [.allow, .deny]
    }
}

public enum Decision: String, Codable, CaseIterable {
    case allow, always, deny
}

public enum ApprovalKind: String, Codable, CaseIterable {
    case permission, plan, question

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ApprovalKind(rawValue: raw) ?? .permission
    }
}

public enum ReplyKind: String, Codable, CaseIterable {
    case reply, ask, summary

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ReplyKind(rawValue: raw) ?? .reply
    }
}

public struct Reply: Codable, Equatable, Identifiable {
    public var id: String
    public var agentId: String
    public var codename: String?
    public var text: String
    public var at: Double
    /// Absent on the wire means `.reply`.
    public var kind: ReplyKind?
    public var from: String?
}

public struct CuckooState: Codable, Equatable {
    public var v: Int
    public var ts: Double
    public var agents: [Agent]
    public var approvals: [Approval]
    public var replies: [Reply]
    public var music: Music?
}

public struct Music: Codable, Equatable {
    public var player: String
    public var playing: Bool
    public var title: String
    public var artist: String?
    public var durationMs: Int64?
    public var positionMs: Int64?
}

public struct UsageWindow: Codable, Equatable {
    public var fiveHour: Int?
    public var sevenDay: Int?
    public var resetsAt: Double?
    public var stale: Bool
    public init(fiveHour: Int?, sevenDay: Int?, resetsAt: Double?, stale: Bool) {
        self.fiveHour = fiveHour; self.sevenDay = sevenDay; self.resetsAt = resetsAt; self.stale = stale
    }
}

public struct Usage: Codable, Equatable {
    public var claude: UsageWindow?
}

public enum SignedIn: Codable, Equatable {
    case yes, no, unknown

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = b ? .yes : .no } else { self = .unknown }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .yes: try c.encode(true)
        case .no: try c.encode(false)
        case .unknown: try c.encode("unknown")
        }
    }
}

public struct CLIInfo: Codable, Equatable, Identifiable {
    public var cli: String
    public var path: String
    public var version: String?
    public var signedIn: SignedIn
    public var chat: Bool?
    public var id: String { cli }
}

public struct ActionResult: Codable, Equatable {
    public var ok: Bool
    public var error: String?
    public var message: String?
    public var relayKey: String?
    public var sha256: String?
    public var sent: String?
    public var focused: Bool?
    public var ref: String?
    public var via: String?
    public var conversationId: String?
    public var cli: String?
    public var text: String?
}

public struct SayRequest: Codable { public var agentId: String; public var text: String
    public init(agentId: String, text: String) { self.agentId = agentId; self.text = text } }
public struct ApproveRequest: Codable { public var id: String; public var decision: Decision
    public init(id: String, decision: Decision) { self.id = id; self.decision = decision } }
public struct FocusRequest: Codable { public var agentId: String
    public init(agentId: String) { self.agentId = agentId } }
public struct LaunchRequest: Codable { public var cwd: String; public var prompt: String; public var cli: String
    public init(cwd: String, prompt: String, cli: String) { self.cwd = cwd; self.prompt = prompt; self.cli = cli } }
public struct ChatRequest: Codable { public var cli: String; public var text: String; public var conversationId: String?
    public var attachments: [String]?
    public init(cli: String, text: String, conversationId: String? = nil, attachments: [String]? = nil) {
        self.cli = cli; self.text = text; self.conversationId = conversationId; self.attachments = attachments } }
public struct ChatEndRequest: Codable { public var conversationId: String
    public init(conversationId: String) { self.conversationId = conversationId } }

public struct UploadResponse: Codable, Equatable {
    public var ok: Bool; public var uploadId: String; public var name: String; public var bytes: Int64; public var mime: String
}

public enum SideId: String, Codable, CaseIterable {
    case mail, whatsapp, music, crypto, github, vercel, stripe, n8n, resend, notion, calcom, recap, notes, phone
}

/// `id` stays a string so a provider added server-side never breaks decoding; map it with `SideId(rawValue:)`.
public struct SideProvider: Codable, Equatable, Identifiable {
    public var id: String
    public var available: Bool
    public var enabled: Bool
    public var via: String?
    public var reason: String?
}

public struct Holding: Codable, Equatable {
    public var symbol: String; public var amount: Double
    public init(symbol: String, amount: Double) { self.symbol = symbol; self.amount = amount }
}

public struct SideSettings: Codable, Equatable {
    public var enabled: [String: Bool]
    public var holdings: [Holding]
    public var currency: String
    public var hideProjects: Bool
    public var phonePush: Bool
}

public struct SideResponse: Codable, Equatable {
    public var ok: Bool; public var providers: [SideProvider]; public var settings: SideSettings
}

public struct SideItem: Codable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var subtitle: String?
    public var value: String?
    public var url: String?
    public var tone: String?
    public var group: String?
    public var actions: [String]
}

public struct SideDataResponse: Codable, Equatable {
    public var ok: Bool; public var id: String; public var updatedAt: Int64; public var items: [SideItem]; public var summary: String?
}

public struct SideActionRequest: Codable {
    public var id: String; public var action: String; public var itemId: String?; public var text: String?
    public init(id: SideId, action: String, itemId: String? = nil, text: String? = nil) {
        self.id = id.rawValue; self.action = action; self.itemId = itemId; self.text = text }
}

public struct SideActionResponse: Codable, Equatable { public var ok: Bool; public var result: String? }

/// Every field optional: only the keys set are sent.
public struct SideSettingsRequest: Codable {
    public var enabled: [String: Bool]?; public var holdings: [Holding]?; public var currency: String?
    public var hideProjects: Bool?; public var phonePush: Bool?
    public init(enabled: [String: Bool]? = nil, holdings: [Holding]? = nil, currency: String? = nil,
                hideProjects: Bool? = nil, phonePush: Bool? = nil) {
        self.enabled = enabled; self.holdings = holdings; self.currency = currency
        self.hideProjects = hideProjects; self.phonePush = phonePush }
}

public struct CountByCli: Codable, Equatable { public var cli: String; public var count: Int }
public struct CountByProject: Codable, Equatable { public var name: String; public var count: Int }

public struct RecapResponse: Codable, Equatable {
    public var ok: Bool; public var week: String
    public var sessions: Int; public var approvals: Int; public var finishes: Int; public var errors: Int
    public var byCli: [CountByCli]; public var topProjects: [CountByProject]?; public var activeDays: Int
}

public struct NotesRequest: Codable { public var title: String; public var transcript: String
    public init(title: String, transcript: String) { self.title = title; self.transcript = transcript } }
public struct NotesResponse: Codable, Equatable { public var ok: Bool; public var noteId: String; public var summary: String }

public struct SuperviseRequest: Codable { public var text: String; public var conversationId: String?; public var cli: String?
    public init(text: String, conversationId: String? = nil, cli: String? = nil) {
        self.text = text; self.conversationId = conversationId; self.cli = cli } }
public struct SuperviseConfirmRequest: Codable { public var confirmId: String; public var cancel: Bool?
    public init(confirmId: String, cancel: Bool? = nil) { self.confirmId = confirmId; self.cancel = cancel } }
public struct StopRequest: Codable { public var agentId: String
    public init(agentId: String) { self.agentId = agentId } }

public struct SuperviseTarget: Codable, Equatable { public var agentId: String; public var name: String }
public struct SupervisePending: Codable, Equatable { public var confirmId: String; public var summary: String; public var expiresAt: Int64 }
public struct SuperviseResult: Codable, Equatable { public var agentId: String; public var ok: Bool; public var error: String? }

/// `intent` stays a string so an intent added server-side never breaks decoding.
public struct SuperviseResponse: Codable, Equatable {
    public var ok: Bool; public var conversationId: String; public var intent: String; public var text: String
    public var targets: [SuperviseTarget]; public var pending: SupervisePending?; public var results: [SuperviseResult]
}

public struct StopResponse: Codable, Equatable { public var ok: Bool; public var relayKey: String }
