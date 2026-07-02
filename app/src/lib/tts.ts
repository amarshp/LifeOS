import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import * as Speech from 'expo-speech'
import { File, Paths } from 'expo-file-system'
import { supabase } from './supabase'

/**
 * Natural text-to-speech for the plan chat: OpenAI TTS via the `plan-tts` edge
 * function (warm human voice), with on-device expo-speech as the offline /
 * error fallback. Drop-in replacement for the previous Speech.speak usage:
 * speak(text, { onDone, onError }) + stop().
 */

interface SpeakCallbacks {
  onDone?: () => void
  onError?: () => void
}

let player: AudioPlayer | null = null
let generation = 0 // invalidates in-flight speaks after stop()

function base64ToBytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const len = Math.floor((clean.length * 3) / 4)
  const out = new Uint8Array(len)
  let o = 0
  for (let i = 0; i + 3 < clean.length || (i < clean.length && o < len); i += 4) {
    const n =
      (alphabet.indexOf(clean[i]) << 18) |
      (alphabet.indexOf(clean[i + 1]) << 12) |
      ((alphabet.indexOf(clean[i + 2]) & 63) << 6) |
      (alphabet.indexOf(clean[i + 3]) & 63)
    if (o < len) out[o++] = (n >> 16) & 255
    if (o < len) out[o++] = (n >> 8) & 255
    if (o < len) out[o++] = n & 255
  }
  return out
}

function teardownPlayer() {
  if (player) {
    try {
      player.remove()
    } catch {}
    player = null
  }
}

/** Stop any current/pending speech (both natural and fallback voices). */
export function stop(): void {
  generation++
  teardownPlayer()
  Speech.stop()
}

function fallbackSpeak(text: string, cb: SpeakCallbacks): void {
  Speech.speak(text, {
    rate: 1.0,
    onDone: () => cb.onDone?.(),
    onStopped: () => {},
    onError: () => cb.onError?.(),
  })
}

/** Speak `text` in the natural voice; falls back to on-device TTS on failure. */
export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
  const spoken = text.trim()
  if (!spoken) {
    cb.onDone?.()
    return
  }
  stop()
  const gen = generation

  try {
    const { data, error } = await supabase.functions.invoke('plan-tts', {
      body: { text: spoken },
    })
    if (error || data?.error || !data?.audio_base64) throw new Error(error?.message || data?.error || 'no audio')
    if (gen !== generation) return // stopped while fetching

    const file = new File(Paths.cache, `plan-tts-${Date.now()}.mp3`)
    file.write(base64ToBytes(data.audio_base64 as string))

    const p = createAudioPlayer({ uri: file.uri })
    player = p
    p.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        teardownPlayer()
        try {
          file.delete()
        } catch {}
        cb.onDone?.()
      }
    })
    p.play()
  } catch {
    if (gen !== generation) return
    fallbackSpeak(spoken, cb)
  }
}
