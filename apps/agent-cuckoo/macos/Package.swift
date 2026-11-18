// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentCuckoo",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "CuckooCore"),
        .executableTarget(name: "CuckooChecks", dependencies: ["CuckooCore"]),
        .executableTarget(name: "AgentCuckoo", dependencies: ["CuckooCore"])
    ],
    swiftLanguageVersions: [.v5]
)
