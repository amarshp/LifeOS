import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Animated, Modal, Alert } from 'react-native'
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  type RecordingStatus,
} from 'expo-audio'
import * as Speech from 'expo-speech'
import * as Haptics from 'expo-haptics'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'

/**
 * Hands-free voice conversation overlay (ChatGPT-style).
 *
 * Runs a continuous loop: listen → (silence detected) → transcribe → respond →
 * speak → listen again. Turn end is detected by voice-activity (mic metering)
 * with a hard time cap as a safety net, so the loop still advances on devices
 * where metering updates are sparse. The user can tap the orb to cut a turn
 * short / barge in, or End to leave.
 *
 * `onTurn` sends the transcript through the chat pipeline and returns the
 * assistant's reply text (which this overlay speaks). Transcription is delegated
 * via `transcribe`.
 */

// Tunables (dB metering is roughly -160 silent … 0 loud on iOS).
const VOICE_DB_THRESHOLD = -40
const SILENCE_MS = 1300 // quiet for this long after speech → end turn
const HARD_CAP_MS = 15000 // max single turn length (also the no-metering turn length)
const TICK_MS = 200

// Stable module-level options so the recorder isn't re-created each render.
const METERED_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }

type VoiceStatus = 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused'

interface Props {
  visible: boolean
  colors: ColorPalette
  onClose: () => void
  transcribe: (uri: string) => Promise<string>
  onTurn: (userText: string) => Promise<string>
}

export function VoiceChatOverlay({ visible, colors, onClose, transcribe, onTurn }: Props) {
  const lastVoiceTsRef = useRef(0)
  const heardVoiceRef = useRef(false)
  const turnStartRef = useRef(0)
  const processingRef = useRef(false)
  const activeRef = useRef(false)
  const emptyCountRef = useRef(0)

  // Orb animation (declared before onStatus, which drives it from mic level).
  const scale = useRef(new Animated.Value(1)).current
  const pulseTo = useCallback(
    (intensity: number) => {
      Animated.timing(scale, { toValue: 1 + intensity * 0.5, duration: 120, useNativeDriver: true }).start()
    },
    [scale],
  )

  const onStatus = useCallback(
    (status: RecordingStatus) => {
      const db = (status as { metering?: number }).metering
      if (typeof db === 'number' && db > VOICE_DB_THRESHOLD) {
        heardVoiceRef.current = true
        lastVoiceTsRef.current = Date.now()
        pulseTo(Math.min(1, (db + 60) / 60))
      }
    },
    [pulseTo],
  )

  const recorder = useAudioRecorder(METERED_OPTIONS, onStatus)
  const [status, setStatus] = useState<VoiceStatus>('listening')
  const statusRef = useRef<VoiceStatus>('listening')
  const setPhase = useCallback((s: VoiceStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  const startListening = useCallback(async () => {
    if (!activeRef.current) return
    heardVoiceRef.current = false
    lastVoiceTsRef.current = Date.now()
    turnStartRef.current = Date.now()
    try {
      // Restore record mode (TTS playback may have disabled it).
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {})
      await recorder.prepareToRecordAsync()
      recorder.record()
      setPhase('listening')
    } catch {
      // ignore; the tick loop will retry on next pass
    }
  }, [recorder, setPhase])

  const endTurn = useCallback(async () => {
    if (processingRef.current || !activeRef.current) return
    processingRef.current = true
    try {
      try {
        await recorder.stop()
      } catch {
        /* already stopped */
      }
      const uri = recorder.uri
      // Gate on captured audio, NOT on metering — metering is only the fast
      // turn-end signal; the loop must work even if it never fires.
      if (!uri) {
        if (activeRef.current) await startListening()
        return
      }
      setPhase('transcribing')
      const text = await transcribe(uri)
      if (!activeRef.current) return
      if (!text) {
        // True silence (or no speech). Back off after a couple of empties so we
        // don't keep uploading silence; tap the orb to resume.
        emptyCountRef.current += 1
        if (emptyCountRef.current >= 2) {
          setPhase('paused')
        } else {
          await startListening()
        }
        return
      }
      emptyCountRef.current = 0
      setPhase('thinking')
      const reply = await onTurn(text)
      if (!activeRef.current) return
      // iOS: leave record mode before speaking, or TTS routes to the earpiece.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {})
      setPhase('speaking')
      Speech.stop()
      Speech.speak(reply || 'Okay.', {
        rate: 1.0,
        onDone: () => {
          if (activeRef.current) void startListening()
        },
        onStopped: () => {},
        onError: () => {
          if (activeRef.current) void startListening()
        },
      })
    } catch (e) {
      Alert.alert('Voice', e instanceof Error ? e.message : 'Voice turn failed')
      if (activeRef.current) await startListening()
    } finally {
      processingRef.current = false
    }
  }, [recorder, transcribe, onTurn, startListening, setPhase])

  // VAD / safety tick.
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => {
      if (statusRef.current !== 'listening' || processingRef.current) return
      const now = Date.now()
      const sinceStart = now - turnStartRef.current
      // Fast path: end shortly after speech goes quiet (needs metering).
      if (heardVoiceRef.current && now - lastVoiceTsRef.current > SILENCE_MS) {
        void endTurn()
        return
      }
      // Safety net: cap turn length regardless of metering, so the loop always
      // advances even if metering never fires.
      if (sinceStart > HARD_CAP_MS) {
        void endTurn()
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [visible, endTurn])

  // Lifecycle: start on open, tear down on close.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    ;(async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Microphone', 'Enable microphone access to use voice chat.')
        onClose()
        return
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {})
      if (cancelled) return
      activeRef.current = true
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      await startListening()
    })()
    return () => {
      cancelled = true
      activeRef.current = false
      Speech.stop()
      recorder.stop().catch(() => {})
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tap orb: barge in (stop speaking → listen) / resume / cut listening short.
  const onTapOrb = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const phase = statusRef.current
    if (phase === 'speaking') {
      Speech.stop()
      void startListening()
    } else if (phase === 'paused') {
      emptyCountRef.current = 0
      void startListening()
    } else if (phase === 'listening') {
      // Always allow a manual turn-end — the only reliable control when metering
      // is absent. endTurn restarts if nothing was captured.
      void endTurn()
    }
  }, [startListening, endTurn])

  const handleClose = useCallback(() => {
    activeRef.current = false
    Speech.stop()
    recorder.stop().catch(() => {})
    onClose()
  }, [recorder, onClose])

  const label: Record<VoiceStatus, string> = {
    listening: 'Listening…',
    transcribing: 'Got it…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    paused: 'Tap to talk',
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} transparent={false}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <Text style={[styles.hint, { color: colors.text3 }]}>Voice chat</Text>
        <View style={styles.center}>
          <Pressable onPress={onTapOrb} hitSlop={24}>
            <Animated.View
              style={[
                styles.orb,
                {
                  backgroundColor: status === 'speaking' ? '#C8102E' : colors.surface3,
                  borderColor: colors.border3,
                  transform: [{ scale }],
                },
              ]}
            />
          </Pressable>
          <Text style={[styles.status, { color: colors.text1 }]}>{label[status]}</Text>
          <Text style={[styles.sub, { color: colors.text3 }]}>
            {status === 'speaking'
              ? 'Tap the orb to interrupt'
              : status === 'paused'
                ? 'Tap the orb when ready'
                : 'Just talk — I’ll respond'}
          </Text>
        </View>
        <Pressable onPress={handleClose} style={[styles.endBtn, { borderColor: colors.border3 }]}>
          <Text style={[styles.endText, { color: colors.text1 }]}>End</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 72 },
  hint: { fontSize: 13, fontFamily: fonts.ui, letterSpacing: 1.5, textTransform: 'uppercase' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  orb: { width: 160, height: 160, borderRadius: 80, borderWidth: 1 },
  status: { fontSize: 22, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.3 },
  sub: { fontSize: 14, fontFamily: fonts.ui },
  endBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 28, borderWidth: 1.5 },
  endText: { fontSize: 16, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: 0.3 },
})
