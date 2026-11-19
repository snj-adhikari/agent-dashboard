import CuckooCore
import Foundation

enum ClientError: Error, LocalizedError {
    case offline, server(status: Int, code: String, message: String)

    var errorDescription: String? {
        switch self {
        case .offline: return t("common.offline")
        case let .server(_, code, message): return t("error.withCode", ["code": code, "message": message])
        }
    }

    var code: String? { if case let .server(_, c, _) = self { return c }; return nil }
}

private struct ApproveBody: Encodable {
    let id: String
    let decision: Decision
    let option: String?
}

struct MonitorClient {
    let base: URL
    let tokenURL: URL

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 4
        return URLSession(configuration: c)
    }()

    /** Chat replies take up to the server's 120 s cap. */
    private static let chatSession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 125
        return URLSession(configuration: c)
    }()

    /** Uploads up to the server's 25 MB cap. */
    private static let uploadSession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 60
        return URLSession(configuration: c)
    }()

    static let uploadLimit: Int64 = 25 * 1024 * 1024

    private func request(_ path: String, body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent("api/v1/cuckoo/\(path)"))
        let token = (try? String(contentsOf: tokenURL, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            r.httpMethod = "POST"
            r.httpBody = body
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    private func send<T: Decodable>(_ r: URLRequest, session: URLSession = MonitorClient.session) async throws -> T {
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: r) } catch let e as URLError where e.code == .timedOut {
            throw ClientError.server(status: 0, code: "timeout", message: t("common.noReply"))
        } catch { throw ClientError.offline }
        return try Self.decode(data, resp)
    }

    private static func decode<T: Decodable>(_ data: Data, _ resp: URLResponse) throws -> T {
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let e = try? JSONDecoder().decode(ActionResult.self, from: data)
            throw ClientError.server(status: status, code: e?.error ?? "http_\(status)", message: e?.message ?? "")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func state() async throws -> CuckooState { try await send(request("state")) }
    func usage() async throws -> Usage { try await send(request("usage")) }
    func clis() async throws -> [CLIInfo] { try await send(request("clis")) }

    func chat(_ body: ChatRequest) async throws -> ActionResult {
        try await send(request("chat", body: try JSONEncoder().encode(body)), session: Self.chatSession)
    }

    func chatEnd(_ conversationId: String) async throws -> ActionResult {
        try await post("chat/end", ChatEndRequest(conversationId: conversationId))
    }

    /** The classifier and the `chat` fallback both run a headless CLI, so these get the chat timeout. */
    func supervise(_ body: SuperviseRequest) async throws -> SuperviseResponse {
        try await send(request("supervise", body: try JSONEncoder().encode(body)), session: Self.chatSession)
    }

    func superviseConfirm(_ body: SuperviseConfirmRequest) async throws -> SuperviseResponse {
        try await send(request("supervise/confirm", body: try JSONEncoder().encode(body)), session: Self.chatSession)
    }

    func stop(_ agentId: String) async throws -> StopResponse {
        try await send(request("stop", body: try JSONEncoder().encode(StopRequest(agentId: agentId))))
    }

    func focus(_ agentId: String) async throws -> ActionResult { try await post("focus", FocusRequest(agentId: agentId)) }

    func launch(_ body: LaunchRequest) async throws -> ActionResult { try await post("launch", body) }

    /** `option` carries a question's chosen label; the server ignores it until it supports picking by label. */
    func approve(_ id: String, _ decision: Decision, option: String?) async throws -> ActionResult {
        try await post("approve", ApproveBody(id: id, decision: decision, option: option))
    }

    func side() async throws -> SideResponse { try await send(request("side")) }
    func sideData(_ id: SideId) async throws -> SideDataResponse { try await send(request("side/\(id.rawValue)")) }
    func sideAction(_ body: SideActionRequest) async throws -> SideActionResponse {
        try await send(request("side/action", body: try JSONEncoder().encode(body)), session: Self.chatSession)
    }
    func sideSettings(_ body: SideSettingsRequest) async throws -> ActionResult { try await post("side/settings", body) }

    func recap(week: String) async throws -> RecapResponse {
        var c = URLComponents(url: base.appendingPathComponent("api/v1/cuckoo/recap"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "week", value: week)]
        var r = request("recap")
        r.url = c.url
        return try await send(r)
    }

    func notes(_ body: NotesRequest) async throws -> NotesResponse {
        try await send(request("notes", body: try JSONEncoder().encode(body)), session: Self.chatSession)
    }

    /** Streams the file as the raw body; the server picks the id and storage path, the client only names it. */
    func upload(_ file: URL, name: String? = nil) async throws -> UploadResponse {
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
        guard size <= Self.uploadLimit else { throw ClientError.server(status: 413, code: "too_large", message: t("error.overSize")) }
        var r = request("upload", body: Data())
        r.httpBody = nil
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        r.setValue(Self.headerName(name ?? file.lastPathComponent), forHTTPHeaderField: "X-Cuckoo-Name")
        let data: Data, resp: URLResponse
        do { (data, resp) = try await Self.uploadSession.upload(for: r, fromFile: file) } catch let e as URLError where e.code == .timedOut {
            throw ClientError.server(status: 0, code: "timeout", message: t("error.uploadTimeout"))
        } catch let e as URLError where e.code == .fileDoesNotExist || e.code == .noPermissionsToReadFile {
            throw ClientError.server(status: 0, code: "no_permission", message: e.localizedDescription)
        } catch { throw ClientError.offline }
        return try Self.decode(data, resp)
    }

    /** Header values must be ASCII; non-ASCII names are percent-encoded and the server sanitises them anyway. */
    private static func headerName(_ name: String) -> String {
        name.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "._- "))) ?? "file"
    }

    func post<B: Encodable>(_ path: String, _ body: B) async throws -> ActionResult {
        try await send(request(path, body: try JSONEncoder().encode(body)))
    }
}
