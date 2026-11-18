import CuckooCore
import Foundation

enum ClientError: Error, LocalizedError {
    case offline, server(status: Int, code: String, message: String)

    var errorDescription: String? {
        switch self {
        case .offline: return "agent-monitor is offline"
        case let .server(_, code, message): return "\(code): \(message)"
        }
    }

    var code: String? { if case let .server(_, c, _) = self { return c }; return nil }
}

struct MonitorClient {
    let base: URL
    let tokenURL: URL

    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 4
        return URLSession(configuration: c)
    }()

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

    private func send<T: Decodable>(_ r: URLRequest) async throws -> T {
        let data: Data, resp: URLResponse
        do { (data, resp) = try await Self.session.data(for: r) } catch { throw ClientError.offline }
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

    func post<B: Encodable>(_ path: String, _ body: B) async throws -> ActionResult {
        try await send(request(path, body: try JSONEncoder().encode(body)))
    }
}
