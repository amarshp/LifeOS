import { Platform } from 'react-native'
import { supabase } from './supabase'

// Remote push transport (Notifications v2): register this device's Expo push
// token so server-side senders (the Phase-4 brain) can reach the phone with
// the app closed. Local reminders don't need this; it is delivery for
// agent/brain notifications only. No-op on web/simulator; the token appears
// once the app runs on a real device with the push-capable native build.

type NotifModule = typeof import('expo-notifications')

let registered = false

export async function registerPushToken(): Promise<void> {
  if (registered || Platform.OS === 'web') return
  let n: NotifModule
  try {
    n = require('expo-notifications') as NotifModule
  } catch {
    return
  }
  try {
    const perm = await n.getPermissionsAsync()
    if (!perm.granted) return // local-notification flow asks; don't double-prompt
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    const token = (await n.getExpoPushTokenAsync()).data
    if (!token) return
    await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userData.user.id, token, platform: Platform.OS, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,token' },
      )
    registered = true
  } catch {
    // simulator, missing entitlement, or offline — retried on next foreground
  }
}
