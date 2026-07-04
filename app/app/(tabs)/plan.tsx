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
  setAudioModeAsync,
} from 'expo-audio'
import * as tts from '../../src/lib/tts'
import * as Haptics from 'expo-haptics'
import { useSettings } from '../../src/contexts/SettingsContext'
import { fonts } from '../../src/theme/tokens'
import { todayStr } from '../../src/lib/date'
import { extractPlanDate } from '../../src/lib/parseDate'
import { addLocalDays } from '../../src/lib/time-range'
import { emitTimerChange } from '../../src/lib/timer-events'
import { SPEECH_RECORDING } from '../../src/lib/speechRecording'
import {
  sendMessage,
  transcribe,
  applyChatPlan,
  undoApply,
  type ApplyUndo,
  type ChatMessage,
  type ChatTurn,
  type ProposedPlan,
} from '../../src/services/plan-chat'
import * as calendarBlocksService from '../../src/services/calendar-blocks'

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
  const { colors, expectedSleepHours } = useSettings()
  const router = useRouter()

  const [date, setDate] = useState<string>(todayStr)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [plan, setPlan] = useState<ProposedPlan | null>(null)
  const [model, setModel] = useState('gpt-4o-mini')
  const [ttsOn, setTtsOn] = useState(true)
  // Diff of the proposal vs what's on the calendar now: item index → status,
  // plus future blocks the proposal would drop. Recomputed when a plan lands.
  const [planDiff, setPlanDiff] = useState<Map<number, 'new' | 'moved' | 'kept'>>(new Map())
  const [droppedTitles, setDroppedTitles] = useState<string[]>([])
  const [lastUndo, setLastUndo] = useState<ApplyUndo | null>(null)

  const recorder = useAudioRecorder(SPEECH_RECORDING)
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
      tts.stop()
    }
  }, [])

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }, [])

  // Keep / Move / Drop / Add — label each proposed item against the calendar
  // as it is right now, so Apply is never a surprise.
  useEffect(() => {
    if (!plan || plan.items.length === 0) {
      setPlanDiff(new Map())
      setDroppedTitles([])
      return
    }
    let alive = true
    calendarBlocksService.getEffectiveBlocksForDate(date)
      .then(blocks => {
        if (!alive) return
        const nowMs = Date.now()
        const isToday = date === todayStr()
        // Only future blocks are up for replacement on a today-replan.
        const relevant = blocks.filter(b => !isToday || new Date(b.start_time).getTime() >= nowMs)
        const blockKey = (iso: string) => {
          const d = new Date(iso)
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        }
        const matchedBlockIds = new Set<string>()
        const diff = new Map<number, 'new' | 'moved' | 'kept'>()
        plan.items.forEach((it, i) => {
          const byTitle = relevant.filter(b => b.title.trim().toLowerCase() === it.title.trim().toLowerCase() && !matchedBlockIds.has(b.id))
          if (byTitle.length === 0) {
            diff.set(i, 'new')
            return
          }
          const exact = byTitle.find(b => blockKey(b.start_time) === it.start_time && blockKey(b.end_time) === it.end_time)
          const match = exact ?? byTitle[0]
          matchedBlockIds.add(match.id)
          diff.set(i, exact ? 'kept' : 'moved')
        })
        setPlanDiff(diff)
        setDroppedTitles(relevant.filter(b => !matchedBlockIds.has(b.id)).map(b => b.title))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [plan, date])

  // Core turn: append user msg → call model → append reply → update plan.
  // Returns the turn (or null on error). Does NOT speak — callers decide.
  // `forDate` overrides the target date for this turn (quick prompts that
  // switch to today can't rely on setDate — the closure would be stale).
  //
  // Opening a fresh chat with a message that names a day ("tomorrow I want
  // to…", "let's plan Friday") sets the planning date from that instead of
  // requiring the date stepper — mid-conversation mentions are left alone so
  // a stray date reference can't silently wipe an in-progress plan.
  const runTurn = useCallback(
    async (text: string, forDate?: string): Promise<ChatTurn | null> => {
      const trimmed = text.trim()
      if (!trimmed) return null
      let effectiveDate = forDate ?? date
      if (!forDate && messagesRef.current.length === 0) {
        const detected = extractPlanDate(trimmed)
        if (detected && detected !== date) {
          effectiveDate = detected
          setDate(detected)
        }
      }
      if (!firstPromptRef.current) firstPromptRef.current = trimmed
      const next: ChatMessage[] = [...messagesRef.current, { role: 'user', content: trimmed }]
      setMessages(next)
      setSending(true)
      scrollToEnd()
      try {
        const turn = await sendMessage(effectiveDate, next, expectedSleepHours)
        setMessages((m) => [...m, { role: 'assistant', content: turn.reply }])
        setPlan(turn.plan)
        setModel(turn.model)
        // Agent changed real data (timers/blocks) → refresh Home/Day views.
        if (turn.actions.length > 0) emitTimerChange()
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
    [date, scrollToEnd, expectedSleepHours],
  )

  // Typed/push-to-talk path: run the turn and read the reply aloud if TTS is on.
  const send = useCallback(
    async (text: string, forDate?: string) => {
      if (!text.trim() || sending) return
      tts.stop()
      setInput('')
      const turn = await runTurn(text, forDate)
      if (turn && ttsOn && turn.reply) void tts.speak(turn.reply)
    },
    [sending, ttsOn, runTurn],
  )

  // Hold-to-talk: press and hold the mic to record, release to transcribe and
  // send. A quick tap (<500ms) is treated as accidental and discarded.
  const holdRef = useRef(false)
  const holdStartTsRef = useRef(0)

  const startHold = useCallback(async () => {
    if (transcribing || sending) return
    holdRef.current = true
    holdStartTsRef.current = Date.now()
    const perm = await AudioModule.requestRecordingPermissionsAsync()
    if (!perm.granted) {
      holdRef.current = false
      Alert.alert('Microphone', 'Enable microphone access to talk to your planner.')
      return
    }
    if (!holdRef.current) return // released before permission resolved
    tts.stop()
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    await recorder.prepareToRecordAsync()
    if (!holdRef.current) return
    recorder.record()
  }, [recorder, transcribing, sending])

  const endHold = useCallback(async () => {
    if (!holdRef.current) return
    holdRef.current = false
    const heldMs = Date.now() - holdStartTsRef.current
    try {
      await recorder.stop()
    } catch {
      /* never started */
    }
    if (heldMs < 500) return // accidental tap — nothing worth transcribing
    try {
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
  }, [recorder, send])

  const apply = useCallback(async () => {
    if (!plan || applying) return
    setApplying(true)
    try {
      const result = await applyChatPlan(date, plan, model, firstPromptRef.current || 'Plan chat')
      setLastUndo(result.undo)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      emitTimerChange()
      const count = result.created
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

  const revertApply = useCallback(async () => {
    if (!lastUndo || applying) return
    setApplying(true)
    try {
      await undoApply(lastUndo)
      setLastUndo(null)
      emitTimerChange()
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Undo failed', e instanceof Error ? e.message : 'Could not revert')
    } finally {
      setApplying(false)
    }
  }, [lastUndo, applying])

  // Changing the day starts a fresh planning session — otherwise a plan proposed
  // for one date could be Applied to another.
  const shiftDate = useCallback((delta: number) => {
    tts.stop()
    setDate((d) => addLocalDays(d, delta))
    setMessages([])
    setPlan(null)
    setInput('')
    setLastUndo(null)
    firstPromptRef.current = ''
  }, [])

  const busy = sending || transcribing
  const planItemCount = plan?.items.length ?? 0

  // Only shown while something is actually happening — the empty-state copy
  // already covers the idle case, so a permanent "Tell me about your day"
  // line here would just be a redundant, oddly-placed label.
  const headerSub = useMemo(() => {
    if (transcribing) return 'Transcribing…'
    if (sending) return 'Thinking…'
    if (recorderState.isRecording) return 'Listening… release to send'
    return null
  }, [transcribing, sending, recorderState.isRecording])

  // One-tap starters. Prompts about the current day flip the target date to
  // today first (a fresh session — chips only show when the chat is empty).
  const quickPrompt = useCallback(
    (text: string, needsToday: boolean) => {
      let target = date
      if (needsToday && date !== todayStr()) {
        target = todayStr()
        setDate(target)
        setPlan(null)
        firstPromptRef.current = ''
      }
      void send(text, target)
    },
    [date, send],
  )

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text1 }]}>Agent</Text>
        <Pressable onPress={() => setTtsOn((v) => !v)} hitSlop={10} style={styles.iconBtn}>
          <SpeakerIcon color={ttsOn ? colors.text1 : colors.text4} on={ttsOn} />
        </Pressable>
      </View>

      {headerSub && <Text style={[styles.sub, { color: colors.text3, paddingHorizontal: 20, paddingTop: 10 }]}>{headerSub}</Text>}
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
              afternoon.” I’ll ask questions, suggest a schedule, and add it to your day. Mention a day
              and I’ll plan that one — no need to touch the date arrows. Hold the mic to talk; release
              to send.
            </Text>
            <View style={styles.quickRow}>
              {([
                { label: 'Plan my day', text: 'Plan my day.', today: false },
                { label: 'Replan from now', text: 'Replan the rest of my day from now — keep what already happened.', today: true },
                { label: "What's left today?", text: "What's left on my plan and tasks today?", today: true },
              ] as const).map((p) => (
                <Pressable
                  key={p.label}
                  onPress={() => quickPrompt(p.text, p.today)}
                  disabled={busy}
                  style={[styles.quickChip, { borderColor: colors.border2, backgroundColor: colors.surface1 }]}
                >
                  <Text style={[styles.quickChipTxt, { color: colors.text2 }]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
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

        {/* Proposed plan card — with a Keep/Move/Drop/Add diff vs the calendar */}
        {plan && planItemCount > 0 && (
          <View style={[styles.planCard, { backgroundColor: colors.surface1, borderColor: colors.border2 }]}>
            <Text style={[styles.planTitle, { color: colors.text1 }]}>{plan.title || 'Proposed plan'}</Text>
            {plan.items.map((it, i) => {
              const status = planDiff.get(i)
              return (
                <View key={i} style={styles.planItem}>
                  <Text style={[styles.planTime, { color: colors.text3 }]}>
                    {fmtHHMM(it.start_time)}–{fmtHHMM(it.end_time)}
                  </Text>
                  <Text style={[styles.planItemTitle, { color: colors.text1 }]} numberOfLines={1}>
                    {it.title}
                    {it.todo_id ? '  ☑' : ''}
                    {it.flexibility === 'fixed' ? '  ⊙' : it.flexibility === 'protected' ? '  ◈' : ''}
                  </Text>
                  {status && status !== 'kept' && (
                    <Text style={[styles.diffTag, { color: status === 'new' ? '#8FBF8A' : '#CCAA6B' }]}>
                      {status === 'new' ? 'new' : 'moved'}
                    </Text>
                  )}
                </View>
              )
            })}
            {droppedTitles.length > 0 && (
              <Text style={[styles.droppedLine, { color: colors.text4 }]} numberOfLines={2}>
                Drops: {droppedTitles.join(', ')}
              </Text>
            )}
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

        {lastUndo && !applying && (
          <Pressable onPress={revertApply} style={[styles.undoPill, { borderColor: colors.border2 }]}>
            <Text style={[styles.undoText, { color: colors.text2 }]}>Undo last apply</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Date selector: below the chat, just the date */}
      <View style={[styles.dateBar, { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.border }]}>
        <Pressable onPress={() => shiftDate(-1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>‹</Text>
        </Pressable>
        <Text style={[styles.dateLabel, { color: colors.text1 }]}>{fmtDate(date)}</Text>
        <Pressable onPress={() => shiftDate(1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>›</Text>
        </Pressable>
      </View>

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
            onPressIn={startHold}
            onPressOut={endHold}
            disabled={transcribing || sending}
            style={[
              styles.circleBtn,
              {
                backgroundColor: recorderState.isRecording ? ACCENT : colors.surface3,
                opacity: transcribing || sending ? 0.6 : 1,
                transform: [{ scale: recorderState.isRecording ? 1.15 : 1 }],
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
  title: { fontSize: 26, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.5, flex: 1 },
  sub: { fontSize: 13, fontFamily: fonts.ui, marginTop: 2 },
  iconBtn: { padding: 6 },
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
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  quickChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  quickChipTxt: { fontSize: 13, fontFamily: fonts.ui, fontWeight: '500' },
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
  diffTag: { fontSize: 10.5, fontFamily: fonts.ui, letterSpacing: 0.8, textTransform: 'uppercase' },
  droppedLine: { fontSize: 12, fontFamily: fonts.ui, marginTop: 8, fontStyle: 'italic' },
  undoPill: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  undoText: { fontSize: 12.5, fontFamily: fonts.ui },
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
