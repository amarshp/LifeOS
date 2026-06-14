// Config plugin: copy LifeOSTrackIntent.swift into the generated iOS project
// and add it to the main app target's sources, so the App Intent + App
// Shortcuts compile into the app binary (required for Siri discovery).

const { withDangerousMod, withXcodeProject, IOSConfig } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const SWIFT_FILE = 'LifeOSTrackIntent.swift'

const withTrackIntent = (config) => {
  // 1. Drop the Swift file into ios/<projectName>/
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const src = path.join(__dirname, SWIFT_FILE)
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
        SWIFT_FILE
      )
      fs.copyFileSync(src, dest)
      return cfg
    },
  ])

  // 2. Register it in the Xcode project's main target sources.
  config = withXcodeProject(config, (cfg) => {
    const projectName = cfg.modRequest.projectName
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${projectName}/${SWIFT_FILE}`,
      groupName: projectName,
      project: cfg.modResults,
    })
    return cfg
  })

  return config
}

module.exports = withTrackIntent
