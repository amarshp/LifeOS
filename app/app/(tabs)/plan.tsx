import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import Svg, { Path, Rect } from 'react-native-svg'
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio'
import * as Speech from 'expo-speech'
import * as Haptics from 'expo-haptics'
import { useSettings } from '../../src/contexts/SettingsContext'
import { fonts } from '../../src/theme/tokens'
import { todayStr } from '../../src/lib/date'
import { addLocalDays } from '../../src/lib/time-range'
import { emitTimerChange } from '../../src/lib/timer-events'
import { VoiceChatOverlay } from '../../src/components/VoiceChatOverlay'
import { TodoBacklog } from '../../src/components/TodoBacklog'
import * as categoriesService from '../../src/services/categories'
import type { Category } from '../../src/types/database'
import {
  sendMessage,
  transcribe,
  applyChatPlan,
  type ChatMessage,
  type ChatTurn,
  type ProposedPlan,
} from '../../src/services/plan-chat'

const ACCENT = '#C8102E'

function fmtDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// The model emits "HH:MM"; render it in the user's locale for the proposal card.
function fmtHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function PlanScreen() {
  const { colors } = useSettings()
  const router = useRouter()

  const [date, setDate] = useState<string>(() => addLocalDays(todayStr(), 1))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [plan, setPlan] = useState<ProposedPlan | null>(null)
  const [model, setModel] = useState('gpt-4o-mini')
  const [ttsOn, setTtsOn] = useState(true)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'tasks'>('chat')
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    categoriesService.getCategories().then(setCategories).catch(() => {})
  }, [])

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder)
  const scrollRef = useRef<ScrollView>(null)
  const firstPromptRef = useRef<string>('')
  // Mirror messages in a ref so the voice loop always sends the latest history.
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }).catch(() => {})
    return () => {
      Speech.stop()
    }
  }, [])

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }, [])

  // Core turn: append user msg → call model → append reply → update plan.
  // Returns the turn (or null on error). Does NOT speak — callers decide.
  const runTurn = useCallback(
    async (text: string): Promise<ChatTurn | null> => {
      const trimmed = text.trim()
      if (!trimmed) return null
      if (!firstPromptRef.current) firstPromptRef.current = trimmed
      const next: ChatMessage[] = [...messagesRef.current, { role: 'user', content: trimmed }]
      setMessages(next)
      setSending(true)
      scrollToEnd()
      try {
        const turn = await sendMessage(date, next)
        setMessages((m) => [...m, { role: 'assistant', content: turn.reply }])
        setPlan(turn.plan)
        setModel(turn.model)
        scrollToEnd()
        return turn
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong'
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${msg}` }])
        return null
      } finally {
        setSending(false)
        scrollToEnd()
      }
    },
    [date, scrollToEnd],
  )

  // Typed/push-to-talk path: run the turn and read the reply aloud if TTS is on.
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return
      Speech.stop()
      setInput('')
      const turn = await runTurn(text)
      if (turn && ttsOn && turn.reply) Speech.speak(turn.reply, { rate: 1.0 })
    },
    [sending, ttsOn, runTurn],
  )

  // Hands-free voice path: run the turn, return the reply for the overlay to speak.
  const voiceTurn = useCallback(async (text: string): Promise<string> => {
    const turn = await runTurn(text)
    return turn?.reply ?? ''
  }, [runTurn])

  const toggleRecording = useCallback(async () => {
    if (recorderState.isRecording) {
      try {
        await recorder.stop()
        setTranscribing(true)
        const uri = recorder.uri
        if (!uri) throw new Error('No audio captured')
        const text = await transcribe(uri)
        if (text) await send(text)
      } catch (e) {
        Alert.alert('Voice', e instanceof Error ? e.message : 'Transcription failed')
      } finally {
        setTranscribing(false)
      }
      return
    }
    // start
    const perm = await AudioModule.requestRecordingPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Microphone', 'Enable microphone access to talk to your planner.')
      return
    }
    Speech.stop()
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    await recorder.prepareToRecordAsync()
    recorder.record()
  }, [recorder, recorderState.isRecording, send])

  const apply = useCallback(async () => {
    if (!plan || applying) return
    setApplying(true)
    try {
      const count = await applyChatPlan(date, plan, model, firstPromptRef.current || 'Plan chat')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      emitTimerChange()
      const skipped = plan.items.length - count
      const note = skipped > 0 ? ` (${skipped} had no category — assign one in Settings, then re-apply.)` : ''
      Alert.alert('Plan applied', `${count} block${count === 1 ? '' : 's'} added to ${fmtDate(date)}.${note}`, [
        { text: 'View day', onPress: () => router.push({ pathname: '/(tabs)/day', params: { date } }) },
        { text: 'OK', style: 'cancel' },
      ])
    } catch (e) {
      Alert.alert('Apply failed', e instanceof Error ? e.message : 'Could not apply plan')
    } finally {
      setApplying(false)
    }
  }, [plan, applying, date, model, router])

  // Changing the day starts a fresh planning session — otherwise a plan proposed
  // for one date could be Applied to another.
  const shiftDate = useCallback((delta: number) => {
    Speech.stop()
    setDate((d) => addLocalDays(d, delta))
    setMessages([])
    setPlan(null)
    setInput('')
    firstPromptRef.current = ''
  }, [])

  const busy = sending || transcribing
  const planItemCount = plan?.items.length ?? 0

  const headerSub = useMemo(() => {
    if (transcribing) return 'Transcribing…'
    if (sending) return 'Thinking…'
    if (recorderState.isRecording) return 'Listening…'
    return 'Tell me about your day'
  }, [transcribing, sending, recorderState.isRecording])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text1 }]}>Plan</Text>
          <Text style={[styles.sub, { color: colors.text3 }]}>{headerSub}</Text>
        </View>
        <Pressable onPress={() => setTtsOn((v) => !v)} hitSlop={10} style={styles.iconBtn}>
          <SpeakerIcon color={ttsOn ? colors.text1 : colors.text4} on={ttsOn} />
        </Pressable>
        <Pressable
          onPress={() => {
            Speech.stop()
            setVoiceOpen(true)
          }}
          hitSlop={10}
          style={[styles.voiceChatBtn, { backgroundColor: colors.surface3, borderColor: colors.border2 }]}
        >
          <WaveIcon color={colors.text1} />
        </Pressable>
      </View>

      {/* Chat / Tasks toggle */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(['chat', 'tasks'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tabBtn}>
            <Text style={[styles.tabTxt, { color: tab === t ? colors.text1 : colors.text4 }]}>
              {t === 'chat' ? 'Plan' : 'Tasks'}
            </Text>
            {tab === t && <View style={[styles.tabUnderline, { backgroundColor: ACCENT }]} />}
          </Pressable>
        ))}
      </View>

      {/* Date selector */}
      <View style={[styles.dateBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => shiftDate(-1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>‹</Text>
        </Pressable>
        <Text style={[styles.dateLabel, { color: colors.text1 }]}>Planning · {fmtDate(date)}</Text>
        <Pressable onPress={() => shiftDate(1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>›</Text>
        </Pressable>
      </View>

      {tab === 'tasks' ? (
        <TodoBacklog
          colors={colors}
          categories={categories}
          planDate={date}
          onPlanChanged={emitTimerChange}
        />
      ) : (
      <>
      {/* Chat */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.chat}
        onContentSizeChange={scrollToEnd}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.text2 }]}>Plan your day, out loud or by text</Text>
            <Text style={[styles.emptyBody, { color: colors.text3 }]}>
              “Tomorrow I want to gym at 7, deep work from 9 to 12, lunch with mom, then admin in the
              afternoon.” I’ll ask questions, suggest a schedule, and add it to your day.
            </Text>
          </View>
        )}

        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === 'user'
                ? [styles.userBubble, { backgroundColor: colors.surface3 }]
                : [styles.aiBubble, { backgroundColor: colors.surface1, borderColor: colors.border }],
            ]}
          >
            <Text style={[styles.bubbleText, { color: colors.text1 }]}>{m.content}</Text>
          </View>
        ))}

        {sending && (
          <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.text3} />
          </View>
        )}

        {/* Proposed plan card */}
        {plan && planItemCount > 0 && (
          <View style={[styles.planCard, { backgroundColor: colors.surface1, borderColor: colors.border2 }]}>
            <Text style={[styles.planTitle, { color: colors.text1 }]}>{plan.title || 'Proposed plan'}</Text>
            {plan.items.map((it, i) => (
              <View key={i} style={styles.planItem}>
                <Text style={[styles.planTime, { color: colors.text3 }]}>
                  {fmtHHMM(it.start_time)}–{fmtHHMM(it.end_time)}
                </Text>
                <Text style={[styles.planItemTitle, { color: colors.text1 }]} numberOfLines={1}>
                  {it.title}
                </Text>
              </View>
            ))}
            <Pressable
              onPress={apply}
              disabled={applying}
              style={[styles.applyBtn, { backgroundColor: ACCENT, opacity: applying ? 0.6 : 1 }]}
            >
              {applying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.applyText}>Apply to {fmtDate(date)}</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface1, color: colors.text1, borderColor: colors.border }]}
          placeholder="Message your planner…"
          placeholderTextColor={colors.text4}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!busy}
          onSubmitEditing={() => send(input)}
        />
        {input.trim().length > 0 ? (
          <Pressable
            onPress={() => send(input)}
            disabled={busy}
            style={[styles.circleBtn, { backgroundColor: ACCENT, opacity: busy ? 0.6 : 1 }]}
          >
            <SendIcon color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            onPress={toggleRecording}
            disabled={transcribing || sending}
            style={[
              styles.circleBtn,
              {
                backgroundColor: recorderState.isRecording ? ACCENT : colors.surface3,
                opacity: transcribing || sending ? 0.6 : 1,
              },
            ]}
          >
            {transcribing ? (
              <ActivityIndicator color={colors.text2} />
            ) : (
              <MicIcon color={recorderState.isRecording ? '#fff' : colors.text1} />
            )}
          </Pressable>
        )}
      </View>
      </>
      )}

      <VoiceChatOverlay
        visible={voiceOpen}
        colors={colors}
        onClose={() => setVoiceOpen(false)}
        transcribe={transcribe}
        onTurn={voiceTurn}
      />
    </KeyboardAvoidingView>
  )
}

function MicIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={3} width={6} height={11} rx={3} stroke={color} strokeWidth={1.8} />
      <Path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  )
}

function SendIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12l16-8-6 16-3-6-7-2z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  )
}

function WaveIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  )
}

function SpeakerIcon({ color, on }: { color: string; on: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9v6h4l5 4V5L8 9H4z" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      {on ? (
        <Path d="M16 9a4 4 0 0 1 0 6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      ) : (
        <Path d="M16 9l4 6M20 9l-4 6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      )}
    </Svg>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 26, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.5 },
  sub: { fontSize: 13, fontFamily: fonts.ui, marginTop: 2 },
  iconBtn: { padding: 6 },
  voiceChatBtn: {
    marginLeft: 6,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabTxt: { fontSize: 14, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: 0.2 },
  tabUnderline: { position: 'absolute', bottom: -1, height: 2, width: 40, borderRadius: 1 },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  dateArrow: { paddingHorizontal: 8 },
  arrow: { fontSize: 26, fontWeight: '600' },
  dateLabel: { fontSize: 14, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2 },
  chat: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { paddingVertical: 40, paddingHorizontal: 8, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: fonts.displaySemiBold, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 21, textAlign: 'center' },
  bubble: { maxWidth: '85%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, fontFamily: fonts.ui, lineHeight: 22 },
  planCard: {
    alignSelf: 'stretch',
    marginTop: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  planTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold, fontWeight: '600', marginBottom: 4 },
  planItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 3 },
  planTime: { fontSize: 13, fontFamily: fonts.ui, fontVariant: ['tabular-nums'], width: 110 },
  planItemTitle: { fontSize: 15, fontFamily: fonts.ui, flex: 1 },
  applyBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: fonts.displaySemiBold, letterSpacing: 0.2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 30,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
    fontFamily: fonts.ui,
  },
  circleBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
