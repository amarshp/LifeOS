// Config plugin: inject a red STOP button + category dot into the
// expo-live-activity SwiftUI, deterministically at `expo prebuild` time
// (EAS always runs prebuild — unlike postinstall, which is unreliable on EAS).
// Edits node_modules/expo-live-activity/ios-files before the library copies
// them into the widget target. Idempotent via a marker comment.

const fs = require('fs')
const path = require('path')

const MARKER = 'LIFEOS_STOP_BUTTON'

const STOP_BUTTON_MEDIUM_FROM = `        }.layoutPriority(1)

        if hasImage, !isLeftImage {
          if let imageName = contentState.imageName {
            alignedImage(imageName, .trailing, false)
          }
        }
      }`

const STOP_BUTTON_MEDIUM_TO = `        }.layoutPriority(1)

        if hasImage, !isLeftImage {
          if let imageName = contentState.imageName {
            alignedImage(imageName, .trailing, false)
          }
        }

        // ${MARKER}
        if let link = attributes.deepLinkUrl, let url = URL(string: link) {
          Spacer(minLength: 8)
          Link(destination: url) {
            ZStack {
              Circle()
                .fill(Color(red: 0.78, green: 0.06, blue: 0.18))
                .frame(width: 46, height: 46)
              RoundedRectangle(cornerRadius: 3)
                .fill(Color.white)
                .frame(width: 16, height: 16)
            }
          }
          .buttonStyle(.plain)
        }
      }`

const COMPACT_DOT_FROM = `      } compactLeading: {
        if let dynamicIslandImageName = context.state.dynamicIslandImageName {
          resizableImage(imageName: dynamicIslandImageName)
            .frame(maxWidth: 23, maxHeight: 23)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        }
      } compactTrailing: {`

const COMPACT_DOT_TO = `      } compactLeading: {
        // ${MARKER}
        if let dynamicIslandImageName = context.state.dynamicIslandImageName {
          resizableImage(imageName: dynamicIslandImageName)
            .frame(maxWidth: 23, maxHeight: 23)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        } else {
          Circle()
            .fill(context.attributes.progressViewTint.map { Color(hex: $0) } ?? .red)
            .frame(width: 10, height: 10)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        }
      } compactTrailing: {`

const DI_STOP_FROM = `        DynamicIslandExpandedRegion(.trailing) {
          if let imageName = context.state.imageName {
            dynamicIslandExpandedTrailing(imageName: imageName)
              .padding(.trailing, 5)
              .applyWidgetURL(from: context.attributes.deepLinkUrl)
          }
        }`

const DI_STOP_TO = `        DynamicIslandExpandedRegion(.trailing) {
          if let imageName = context.state.imageName {
            dynamicIslandExpandedTrailing(imageName: imageName)
              .padding(.trailing, 5)
              .applyWidgetURL(from: context.attributes.deepLinkUrl)
          } else if let link = context.attributes.deepLinkUrl, let url = URL(string: link) {
            Link(destination: url) {
              ZStack {
                Circle()
                  .fill(Color(red: 0.78, green: 0.06, blue: 0.18))
                  .frame(width: 40, height: 40)
                RoundedRectangle(cornerRadius: 3)
                  .fill(Color.white)
                  .frame(width: 14, height: 14)
              }
            }
            .buttonStyle(.plain)
            .padding(.trailing, 5)
          }
        }`

function patchFile(file, edits) {
  let src = fs.readFileSync(file, 'utf8')
  if (src.includes(MARKER)) return // already patched
  for (const [from, to] of edits) {
    if (!src.includes(from)) {
      throw new Error(
        `[withLiveActivityStopButton] anchor not found in ${path.basename(file)} — ` +
          `the library SwiftUI changed; update the plugin.`
      )
    }
    src = src.replace(from, to)
  }
  fs.writeFileSync(file, src)
}

module.exports = function withLiveActivityStopButton(config) {
  const pkgDir = path.dirname(require.resolve('expo-live-activity/package.json'))
  const iosFiles = path.join(pkgDir, 'ios-files')
  patchFile(path.join(iosFiles, 'LiveActivityMediumView.swift'), [
    [STOP_BUTTON_MEDIUM_FROM, STOP_BUTTON_MEDIUM_TO],
  ])
  patchFile(path.join(iosFiles, 'LiveActivityWidget.swift'), [
    [COMPACT_DOT_FROM, COMPACT_DOT_TO],
    [DI_STOP_FROM, DI_STOP_TO],
  ])
  return config
}
