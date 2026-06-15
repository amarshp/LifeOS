import AppIntents
import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif
import ExpoLiveActivity

// LifeOS Siri / Shortcut "track" commands (no-app-open live sync).
// App Intents run in the app process in the background (even while locked) but do
// NOT boot React Native. So the intent itself:
//   1. POSTs to the Supabase `voice-track` Edge Function (authed by a per-device
//      secret RN stored in lifeos_voice_cred.json) → DB is written LIVE.
//   2. Drives ActivityKit directly (expo-live-activity's now-public
//      LiveActivityAttributes) → Lock Screen / Dynamic Island update LIVE, app closed.
//   3. On network failure, falls back to the local queue (RN applies on next open).
// The activity id is written to lifeos_la_map.json so RN adopts it on next open
// (no duplicates). Task options for the Shortcuts UI come from lifeos_quick_tasks.json.

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

// MARK: - Live Activity (ActivityKit, shared expo-live-activity attributes)

@available(iOS 16.0, *)
private func saveActivityId(entryId: String, activityId: String) {
  guard !entryId.isEmpty, let url = documentsURL("lifeos_la_map.json") else { return }
  var map: [String: String] = [:]
  if let data = try? Data(contentsOf: url),
     let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
    map = obj
  }
  map[entryId] = activityId
  if let data = try? JSONSerialization.data(withJSONObject: map, options: []) {
    try? data.write(to: url, options: .atomic)
  }
}

@available(iOS 16.0, *)
private func mappedActivityId(_ entryId: String) -> String? {
  guard let url = documentsURL("lifeos_la_map.json"),
        let data = try? Data(contentsOf: url),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: String]
  else { return nil }
  return map[entryId]
}

private func isoToMs(_ s: String?) -> Double? {
  guard let s = s else { return nil }
  let f1 = ISO8601DateFormatter()
  f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let d = f1.date(from: s) { return d.timeIntervalSince1970 * 1000 }
  let f2 = ISO8601DateFormatter()
  if let d = f2.date(from: s) { return d.timeIntervalSince1970 * 1000 }
  return nil
}

@available(iOS 16.2, *)
private func applyLiveActivity(_ result: [String: Any]) async {
#if canImport(ActivityKit)
  guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
  let action = result["action"] as? String ?? "start"
  let entryId = result["entry_id"] as? String ?? ""
  let title = result["title"] as? String ?? ""
  let running = (result["is_running"] as? Bool) ?? true

  // stop (or idempotent replay of an already-stopped entry) → end the mapped activity
  if action == "stop" || !running {
    if let aid = mappedActivityId(entryId) {
      for act in Activity<LiveActivityAttributes>.activities where act.id == aid {
        await act.end(nil, dismissalPolicy: .immediate)
      }
    }
    return
  }

  // start ends existing activities; parallel leaves them running
  if action == "start" {
    for act in Activity<LiveActivityAttributes>.activities {
      await act.end(nil, dismissalPolicy: .immediate)
    }
  }

  let startMs = isoToMs(result["start_time"] as? String) ?? (Date().timeIntervalSince1970 * 1000)
  let attrs = LiveActivityAttributes(
    name: "ExpoLiveActivity",
    backgroundColor: "#0A0A0A",
    titleColor: "#FFFFFF",
    subtitleColor: "#9CA3AF",
    progressViewTint: "#C8102E",
    progressViewLabelColor: "#FFFFFF",
    deepLinkUrl: "lifeos://stop-start?entry=\(entryId)",
    timerType: .digital
  )
  let state = LiveActivityAttributes.ContentState(
    title: title,
    elapsedTimerStartDateInMilliseconds: startMs
  )
  if let act = try? Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil)) {
    saveActivityId(entryId: entryId, activityId: act.id)
  }
#endif
}

// Shared run path: write to Supabase live + drive the Live Activity, else queue.
@available(iOS 16.0, *)
private func runTrack(title: String) async {
  let commandId = UUID().uuidString
  let at = ISO8601DateFormatter().string(from: Date())
  if let result = await postVoiceTrack(commandId: commandId, title: title, at: at) {
    if #available(iOS 16.2, *) { await applyLiveActivity(result) }
  } else {
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
        "Track \(\.$task) in \(.applicationName)",
        "Track \(\.$task) on \(.applicationName)",
      ],
      shortTitle: "Track",
      systemImageName: "record.circle"
    )
    AppShortcut(
      intent: TrackDictateIntent(),
      phrases: [
        "Track in \(.applicationName)",
        "\(.applicationName) track",
        "New entry in \(.applicationName)",
        "Log in \(.applicationName)",
      ],
      shortTitle: "New entry",
      systemImageName: "mic.circle"
    )
  }
}
