import { File, Paths } from 'expo-file-system'
import { supabase } from './supabase'

// Per-device voice credential for the no-app-open Siri/Shortcut path.
// The DB mints the secret (register_voice_credential RPC) and stores only its
// hash; we persist the raw secret + endpoint to a shared Documents file that the
// native App Intent reads to call the `voice-track` Edge Function directly.
//
// NOTE: shared Documents file is readable after first unlock (fine for Siri).
// Hardening upgrade: move the secret to the Keychain (see FEATURES.md roadmap).

const CRED_FILE = 'lifeos_voice_cred.json'
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

interface LocalCred {
  userId: string
  deviceId: string
  secret: string
  functionUrl: string
  anonKey: string
}

function readLocal(): LocalCred | null {
  try {
    const f = new File(Paths.document, CRED_FILE)
    if (!f.exists) return null
    return JSON.parse(f.textSync()) as LocalCred
  } catch {
    return null
  }
}

function writeLocal(cred: LocalCred): void {
  try {
    const f = new File(Paths.document, CRED_FILE)
    if (f.exists) f.delete()
    f.create()
    f.write(JSON.stringify(cred))
  } catch {
    // best-effort
  }
}

// Register (or re-register on user change) the device credential. Idempotent:
// once a credential for the current user exists locally, it's a no-op.
export async function ensureVoiceCredential(): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const existing = readLocal()
    if (existing && existing.userId === user.id && existing.secret) return // already set up

    const { data, error } = await supabase.rpc('register_voice_credential', {
      p_device_id: existing?.deviceId ?? null, // reuse the device id, rotate the secret
    })
    if (error || !data) return
    const { device_id, secret } = data as { device_id: string; secret: string }
    if (!device_id || !secret) return

    writeLocal({
      userId: user.id,
      deviceId: device_id,
      secret,
      functionUrl: `${SUPABASE_URL}/functions/v1/voice-track`,
      anonKey: ANON_KEY,
    })
  } catch {
    // best-effort; native path simply falls back to the queue if no cred file
  }
}

// Device id of the current local credential (for the push-to-start token row).
export function getVoiceDeviceId(): string | null {
  return readLocal()?.deviceId ?? null
}

// Revoke on sign-out so a shared device can't keep logging to the old account.
export async function revokeVoiceCredential(): Promise<void> {
  const local = readLocal()
  try {
    if (local?.deviceId) {
      await supabase.rpc('revoke_voice_credential', { p_device_id: local.deviceId })
    }
  } catch {
    // ignore
  }
  try {
    const f = new File(Paths.document, CRED_FILE)
    if (f.exists) f.delete()
  } catch {
    // ignore
  }
}
