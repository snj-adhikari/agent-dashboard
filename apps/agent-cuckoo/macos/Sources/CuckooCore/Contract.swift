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

    public init(id: String, name: String, codename: String? = nil, colour: String? = nil,
                state: AgentState, host: String = "herdr", terminalApp: String? = nil,
                scope: String? = nil, space: String, isMain: Bool = false, cwd: String? = nil,
                branch: String? = nil, lastLine: String? = nil, cli: String? = nil, canSend: Bool = true) {
        self.id = id; self.name = name; self.codename = codename; self.colour = colour
        self.state = state; self.host = host; self.terminalApp = terminalApp; self.scope = scope
        self.space = space; self.isMain = isMain; self.cwd = cwd; self.branch = branch
        self.lastLine = lastLine; self.cli = cli; self.canSend = canSend
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

    public init(id: String, agentId: String, tool: String = "Bash", command: String = "",
                options: [ApprovalOption] = [], receivedAt: Double, screenHash: String = "") {
        self.id = id; self.agentId = agentId; self.tool = tool; self.command = command
        self.options = options; self.receivedAt = receivedAt; self.screenHash = screenHash
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

public struct Reply: Codable, Equatable, Identifiable {
    public var id: String
    public var agentId: String
    public var codename: String?
    public var text: String
    public var at: Double
}

public struct CuckooState: Codable, Equatable {
    public var v: Int
    public var ts: Double
    public var agents: [Agent]
    public var approvals: [Approval]
    public var replies: [Reply]
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
}

public struct SayRequest: Codable { public var agentId: String; public var text: String
    public init(agentId: String, text: String) { self.agentId = agentId; self.text = text } }
public struct ApproveRequest: Codable { public var id: String; public var decision: Decision
    public init(id: String, decision: Decision) { self.id = id; self.decision = decision } }
public struct FocusRequest: Codable { public var agentId: String
    public init(agentId: String) { self.agentId = agentId } }
public struct LaunchRequest: Codable { public var cwd: String; public var prompt: String; public var cli: String
    public init(cwd: String, prompt: String, cli: String) { self.cwd = cwd; self.prompt = prompt; self.cli = cli } }
