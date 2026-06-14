import AppIntents
import Foundation

// LifeOS Siri "track" commands. App Intents run in the app process in the
// background (even while locked) and CAPTURE a command to a queue file in the
// app's Documents dir. RN drains the queue on next foreground and applies it to
// Supabase (backdated to when spoken, with a `review` tag). No native network.
//
// Task options come from lifeos_quick_tasks.json (written by RN): the user's
// categories + recent task titles, so Siri can match a spoken name.

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

@available(iOS 16.0, *)
private func loadDefaultCategoryId() -> String { loadConfig().defaultCategoryId }

@available(iOS 16.0, *)
private func enqueue(title: String, categoryId: String) {
  guard let url = documentsURL("lifeos_track_queue.json") else { return }
  var queue: [[String: Any]] = []
  if let data = try? Data(contentsOf: url),
     let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    queue = arr
  }
  // Action (start / stop / parallel) is parsed from the title on the JS side, so
  // it can be tuned with a JS reload instead of a native rebuild.
  queue.append([
    "action": "track",
    "categoryId": categoryId,
    "title": title,
    "at": ISO8601DateFormatter().string(from: Date()),
  ])
  if let data = try? JSONSerialization.data(withJSONObject: queue, options: []) {
    try? data.write(to: url, options: .atomic)
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
  // exact match → fuzzy contains → else a free-text entry under the default
  // category. The title is whatever was spoken.
  func entities(matching string: String) async throws -> [TaskEntity] {
    let q = string.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = q.lowercased()
    let all = loadTasks()
    if let exact = all.first(where: { $0.title.lowercased() == lower }) { return [exact] }
    if let part = all.first(where: { $0.title.lowercased().contains(lower) || lower.contains($0.title.lowercased()) }) {
      return [part]
    }
    return [TaskEntity(id: "free:\(lower)", title: q, categoryId: loadDefaultCategoryId())]
  }
  // Return [] so Siri accepts dictated free text (e.g. "track sleep") and routes
  // it to entities(matching:) — which resolves to a single entry — instead of
  // showing a "which one?" disambiguation list of every task. (Apple: empty
  // suggestions enables dictation capture for the phrase parameter.)
  func suggestedEntities() async throws -> [TaskEntity] {
    []
  }
}

// MARK: - Intents

// Single one-shot intent: "LifeOS <title>" captures the whole tail as the title.
// start / stop / parallel are derived from the title by the JS drain (keyword
// prefix: "stop …", "parallel …", "also …"), so routing is tunable without a
// native rebuild and there is no cross-phrase collision.
@available(iOS 16.0, *)
struct TrackIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a task"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: TaskEntity

  // No ProvidesDialog → Siri dismisses immediately instead of lingering 6-8s on
  // a "Got it" snippet (annoying for a fire-and-forget logging action).
  func perform() async throws -> some IntentResult {
    enqueue(title: task.title, categoryId: task.categoryId)
    return .result()
  }
}

// Reliable two-step fallback. Trigger "New entry in LifeOS" has the app name at
// the END so it can't collide with the greedy "LifeOS <task>" phrase. Siri asks
// via requestValueDialog and captures arbitrary dictation as a plain String —
// the one mechanism Apple guarantees for open-ended text.
@available(iOS 16.0, *)
struct TrackDictateIntent: AppIntent {
  static var title: LocalizedStringResource = "New LifeOS entry"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task", requestValueDialog: "What are you tracking?")
  var titleText: String

  func perform() async throws -> some IntentResult {
    enqueue(title: titleText, categoryId: loadDefaultCategoryId())
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
        // "LifeOS Commute to movie" — everything after the app name is the title
        // (free text via empty suggestedEntities). Say "LifeOS stop sleep" /
        // "LifeOS parallel gym" and the JS drain routes by the leading keyword.
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
