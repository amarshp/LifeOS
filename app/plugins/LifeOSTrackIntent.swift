import AppIntents
import Foundation

// SPIKE: prove an App Intent runs in the background while the phone is locked,
// triggered by Siri ("Track <task> in LifeOS"), without unlocking. perform()
// writes the spoken task + timestamp to the app's Documents dir; RN reads it
// back on next foreground to confirm the background execution happened.

@available(iOS 16.0, *)
struct TrackIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a task"
  static var openAppWhenRun: Bool = false
  // Run while locked without requiring Face ID / passcode.
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "Task")
  var task: String

  init() {}
  init(task: String) { self.task = task }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let payload: [String: Any] = [
      "task": task,
      "at": ISO8601DateFormatter().string(from: Date()),
    ]
    if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      let url = dir.appendingPathComponent("lifeos_track.json")
      if let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
        try? data.write(to: url, options: .atomic)
      }
    }
    return .result(dialog: "Tracking \(task)")
  }
}

@available(iOS 16.0, *)
struct LifeOSAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TrackIntent(),
      phrases: [
        "Track \(\.$task) in \(.applicationName)",
        "\(.applicationName) track \(\.$task)",
      ],
      shortTitle: "Track",
      systemImageName: "record.circle"
    )
  }
}
