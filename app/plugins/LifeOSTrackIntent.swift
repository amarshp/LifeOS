import AppIntents
import Foundation

// SPIKE: prove an App Intent runs in the background while the phone is locked,
// triggered by Siri, without unlocking. Parameterless on purpose — App Shortcut
// phrase parameters must be AppEntity/AppEnum, not free text (that's Phase A).
// perform() writes a timestamp to the app's Documents dir; RN reads it back on
// next foreground to confirm the background execution happened while locked.

@available(iOS 16.0, *)
struct TrackIntent: AppIntent {
  static var title: LocalizedStringResource = "Track a task"
  static var openAppWhenRun: Bool = false
  // Run while locked without requiring Face ID / passcode.
  static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let payload: [String: Any] = [
      "task": "siri test",
      "at": ISO8601DateFormatter().string(from: Date()),
    ]
    if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      let url = dir.appendingPathComponent("lifeos_track.json")
      if let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
        try? data.write(to: url, options: .atomic)
      }
    }
    return .result(dialog: "Tracked")
  }
}

@available(iOS 16.0, *)
struct LifeOSAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TrackIntent(),
      phrases: [
        "Track in \(.applicationName)",
        "\(.applicationName) track",
      ],
      shortTitle: "Track",
      systemImageName: "record.circle"
    )
  }
}
