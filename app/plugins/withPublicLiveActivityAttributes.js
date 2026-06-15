// Config plugin: make expo-live-activity's pod attributes type `public` so the
// LifeOS App Intent (app target) can construct Activity<LiveActivityAttributes>
// the widget renders. Overwrites the pod's internal LiveActivityAttributes.swift
// with a public, same-shape copy at prebuild (runs before pod install / compile).

const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const withPublicLiveActivityAttributes = (config) => {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const src = path.join(__dirname, 'LiveActivityAttributes.public.swift')
      const dest = path.join(
        cfg.modRequest.projectRoot,
        'node_modules',
        'expo-live-activity',
        'ios',
        'LiveActivityAttributes.swift'
      )
      try {
        fs.copyFileSync(src, dest)
      } catch (e) {
        console.warn('[withPublicLiveActivityAttributes] failed:', e.message)
      }
      return cfg
    },
  ])
}

module.exports = withPublicLiveActivityAttributes
