import { RecordingPresets, type RecordingOptions } from 'expo-audio'

// Speech-optimized recording: 16 kHz mono AAC (~32 kbps). ~8x smaller than
// HIGH_QUALITY, so the base64 upload to plan-transcribe survives weak links —
// and Whisper is trained on 16 kHz anyway.
export const SPEECH_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
}
