import { Platform } from 'react-native'
import { supabase } from './supabase'
import { getVoiceDeviceId } from './voiceCredential'

// APNs push-to-start: ActivityKit issues a token (iOS 17.2+) we use to start a
// Live Activity from a server while the app is closed. Capture it once and store
// it on this device's voice_credentials row. Idempotent: re-stores only on change.

type LiveActivityModule = typeof import('expo-live-activity')

let lastToken: string | null = null
let subscribed = false

function getModule(): LiveActivityModule | null {
  if (Platform.OS !== 'ios') return null
  try {
    return require('expo-live-activity') as LiveActivityModule
  } catch (e) {
    if (__DEV__) console.warn('[PTS] module require FAILED:', e)
    return null
  }
}

async function store(token: string): Promise<void> {
  if (token === lastToken) return
  const deviceId = getVoiceDeviceId()
  if (!deviceId) {
    if (__DEV__) console.log('[PTS] no deviceId yet; will retry on next token')
    return
  }
  const { error } = await supabase.rpc('set_push_to_start_token', {
    p_device_id: deviceId,
    p_token: token,
  })
  if (error) {
    if (__DEV__) console.warn('[PTS] store failed:', error.message)
    return
  }
  lastToken = token
  if (__DEV__) console.log('[PTS] stored push-to-start token')
}

// Call once after the credential is ensured. Registers the listener; the token
// arrives asynchronously (and again on rotation).
export function registerPushToStartToken(): void {
  if (subscribed) return
  const la = getModule()
  if (!la) return
  try {
    la.addActivityPushToStartTokenListener((event) => {
      const token = event.activityPushToStartToken
      if (token) void store(token)
    })
    subscribed = true
    if (__DEV__) console.log('[PTS] listener registered')
  } catch (e) {
    if (__DEV__) console.warn('[PTS] listener register failed:', e)
  }
}
