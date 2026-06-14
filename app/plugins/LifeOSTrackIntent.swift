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
private func loadTasks() -> [TaskEntity] {
  guard let url = documentsURL("lifeos_quick_tasks.json"),
        let data = try? Data(contentsOf: url),
        let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
  else { return [] }
  return arr.compactMap { item in
    guard let id = item["id"] as? String,
          let title = item["title"] as? String,
          let categoryId = item["categoryId"] as? String else { return nil }
    return TaskEntity(id: id, title: title, categoryId: categoryId)
  }
}

@available(iOS 16.0, *)
private func enqueue(action: String, task: TaskEntity) {
  guard let url = documentsURL("lifeos_track_queue.json") else { return }
  var queue: [[String: Any]] = []
  if let data = try? Data(contentsOf: url),
     let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    queue = arr
  }
  queue.append([
    "action": action,
    "categoryId": task.categoryId,
    "title": task.title,
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
  // Siri matches the spoken task name against the synced task list.
  func entities(matching string: String) async throws -> [TaskEntity] {
    let q = string.lowercased()
    return loadTasks().filter {
      let t = $0.title.lowercased()
      return t.contains(q) || q.contains(t)
    }
  }
  func suggestedEntities() async throws -> [TaskEntity] {
    loadTasks()
  }
}

// MARK: - Intents

@available(iOS 16.0, *)
struct TrackIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a task"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: TaskEntity

  func perform() async throws -> some IntentResult & ProvidesDialog {
    enqueue(action: "start", task: task)
    return .result(dialog: "Tracking \(task.title)")
  }
}

@available(iOS 16.0, *)
struct TrackParallelIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a parallel task"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: TaskEntity

  func perform() async throws -> some IntentResult & ProvidesDialog {
    enqueue(action: "parallel", task: task)
    return .result(dialog: "Tracking \(task.title) in parallel")
  }
}

@available(iOS 16.0, *)
struct TrackStopIntent: AppIntent {
  static var title: LocalizedStringResource = "Stop tracking a task"
  static var openAppWhenRun: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: TaskEntity

  func perform() async throws -> some IntentResult & ProvidesDialog {
    enqueue(action: "stop", task: task)
    return .result(dialog: "Stopping \(task.title)")
  }
}

// MARK: - Siri phrases (app name required by Apple)

@available(iOS 16.0, *)
struct LifeOSAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TrackIntent(),
      phrases: ["Track \(\.$task) in \(.applicationName)"],
      shortTitle: "Track",
      systemImageName: "record.circle"
    )
    AppShortcut(
      intent: TrackParallelIntent(),
      phrases: ["Track parallel \(\.$task) in \(.applicationName)"],
      shortTitle: "Track parallel",
      systemImageName: "plus.circle"
    )
    AppShortcut(
      intent: TrackStopIntent(),
      phrases: ["Track stop \(\.$task) in \(.applicationName)"],
      shortTitle: "Track stop",
      systemImageName: "stop.circle"
    )
  }
}
