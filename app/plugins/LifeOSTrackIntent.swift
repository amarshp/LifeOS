import AppIntents
import Foundation

// LifeOS Siri / Shortcut "track" commands (no-app-open live sync).
// App Intents run in the app process in the background (even while locked) but do
// NOT boot React Native. So the intent itself:
//   1. POSTs to the Supabase `voice-track` Edge Function (authed by a per-device
//      secret RN stored in lifeos_voice_cred.json) → DB is written LIVE.
//   2. On network failure, falls back to the local queue (RN applies on next open,
//      idempotently via command_id).
// The Live Activity updates when the app is next opened (RN reconcile reads the
// new running entry from the DB). Driving ActivityKit directly from the intent is
// a follow-up (needs expo-live-activity's LiveActivityAttributes exported to the
// app target — not currently visible cross-module).
// Task options for the Shortcuts UI come from lifeos_quick_tasks.json (RN-written).

// MARK: - Shared file helpers

@available(iOS 16.0, *)
private func documentsURL(_ name: String) -> URL? {
  FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
    .appendingPathComponent(name)
}

@available(iOS 16.0, *)
private func loadConfig() -> (defaultCategoryId: String, tasks: [TaskEntity]) {
  guard let url = documentsURL("lifeos_quick_tasks.json"),
        let data = try? Data(contentsOf: url),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return ("", []) }
  let def = obj["defaultCategoryId"] as? String ?? ""
  let arr = obj["tasks"] as? [[String: Any]] ?? []
  let tasks: [TaskEntity] = arr.compactMap { item in
    guard let id = item["id"] as? String,
          let title = item["title"] as? String,
          let categoryId = item["categoryId"] as? String else { return nil }
    return TaskEntity(id: id, title: title, categoryId: categoryId)
  }
  return (def, tasks)
}

@available(iOS 16.0, *)
private func loadTasks() -> [TaskEntity] { loadConfig().tasks }

// MARK: - Voice credential + network (DB-live path)

@available(iOS 16.0, *)
private func loadVoiceCred() -> (url: String, deviceId: String, secret: String, anonKey: String)? {
  guard let u = documentsURL("lifeos_voice_cred.json"),
        let data = try? Data(contentsOf: u),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let url = obj["functionUrl"] as? String,
        let deviceId = obj["deviceId"] as? String,
        let secret = obj["secret"] as? String,
        let anonKey = obj["anonKey"] as? String
  else { return nil }
  return (url, deviceId, secret, anonKey)
}

// POST to the Edge Function. Returns the inner `result` dict on success, else nil.
@available(iOS 16.0, *)
private func postVoiceTrack(commandId: String, title: String, at: String) async -> [String: Any]? {
  guard let cred = loadVoiceCred(), let url = URL(string: cred.url) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.timeoutInterval = 12
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  req.setValue(cred.anonKey, forHTTPHeaderField: "apikey")
  req.setValue("Bearer \(cred.anonKey)", forHTTPHeaderField: "Authorization")
  req.setValue(cred.secret, forHTTPHeaderField: "x-device-secret")
  let body: [String: Any] = [
    "device_id": cred.deviceId, "command_id": commandId, "title": title, "at": at,
  ]
  req.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
  do {
    let (data, resp) = try await URLSession.shared.data(for: req)
    guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return (obj["result"] as? [String: Any]) ?? obj
  } catch {
    return nil
  }
}

// Fallback queue (RN drains on next open, idempotent via command_id).
@available(iOS 16.0, *)
private func enqueueFallback(commandId: String, title: String, at: String) {
  guard let url = documentsURL("lifeos_track_queue.json") else { return }
  var queue: [[String: Any]] = []
  if let data = try? Data(contentsOf: url),
     let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    queue = arr
  }
  queue.append(["command_id": commandId, "title": title, "at": at])
  if let data = try? JSONSerialization.data(withJSONObject: queue, options: []) {
    try? data.write(to: url, options: .atomic)
  }
}

// Shared run path for all intents: write to Supabase live, else queue fallback.
@available(iOS 16.0, *)
private func runTrack(title: String) async {
  let commandId = UUID().uuidString
  let at = ISO8601DateFormatter().string(from: Date())
  if await postVoiceTrack(commandId: commandId, title: title, at: at) == nil {
    enqueueFallback(commandId: commandId, title: title, at: at)
  }
}

// MARK: - Task entity (Siri matches the spoken name against these)

@available(iOS 16.0, *)
struct TaskEntity: AppEntity {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Task")
  static var defaultQuery = TaskEntityQuery()

  var id: String
  var title: String
  var categoryId: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

@available(iOS 16.0, *)
struct TaskEntityQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [TaskEntity] {
    loadTasks().filter { identifiers.contains($0.id) }
  }
  // Resolve the spoken text to exactly ONE entity so Siri never prompts:
  // exact match → fuzzy contains → else a free-text entry. Title = what was spoken.
  func entities(matching string: String) async throws -> [TaskEntity] {
    let q = string.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = q.lowercased()
    let all = loadTasks()
    if let exact = all.first(where: { $0.title.lowercased() == lower }) { return [exact] }
    if let part = all.first(where: { $0.title.lowercased().contains(lower) || lower.contains($0.title.lowercased()) }) {
      return [part]
    }
    return [TaskEntity(id: "free:\(lower)", title: q, categoryId: "")]
  }
  // Return [] so Siri accepts dictated free text instead of showing a list.
  func suggestedEntities() async throws -> [TaskEntity] { [] }
}

// MARK: - Intents

// Single one-shot intent: "LifeOS <title>" captures the whole tail as the title.
// start / stop / parallel are derived from the title server-side (SQL).
@available(iOS 16.0, *)
struct TrackIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a task"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: TaskEntity

  func perform() async throws -> some IntentResult {
    await runTrack(title: task.title)
    return .result()
  }
}

// Reliable two-step fallback. "New entry in LifeOS" → Siri asks → dictate.
@available(iOS 16.0, *)
struct TrackDictateIntent: AppIntent {
  static var title: LocalizedStringResource = "New LifeOS entry"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task", requestValueDialog: "What are you tracking?")
  var titleText: String

  func perform() async throws -> some IntentResult {
    await runTrack(title: titleText)
    return .result()
  }
}

// MARK: - Siri phrases (app name required by Apple)

@available(iOS 16.0, *)
struct LifeOSAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TrackIntent(),
      phrases: [
        // "LifeOS Commute to movie" — everything after the app name is the title.
        "\(.applicationName) \(\.$task)",
        "Track \(\.$task) in \(.applicationName)",
        "Track \(\.$task) on \(.applicationName)",
      ],
      shortTitle: "Track",
      systemImageName: "record.circle"
    )
    AppShortcut(
      intent: TrackDictateIntent(),
      phrases: [
        "New entry in \(.applicationName)",
        "Log in \(.applicationName)",
      ],
      shortTitle: "New entry",
      systemImageName: "mic.circle"
    )
  }
}
