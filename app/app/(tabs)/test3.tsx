import { View, Text, ScrollView, Pressable, StyleSheet, Animated } from 'react-native'
import { useRef, useEffect } from 'react'
import Svg, { Path, Circle } from 'react-native-svg'
import { fonts } from '../../src/theme/tokens'
import { useHomeData } from '../../src/hooks/useHomeData'
import { formatElapsed } from '../../src/hooks/useTimer'
import { relativeTime, formatHours } from '../../src/lib/format'
import { toLocalDateStr } from '../../src/lib/date'
import type { TimeEntry, Category } from '../../src/types/database'

const GAP_CARD_MIN_MS = 30 * 60_000 // untracked stretch worth asking about
const DRIFT_CARD_MIN_MS = 45 * 60_000 // plan this far behind → offer replan

function fmtDurationShort(ms: number): string {
  const mins = Math.round(ms / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * test3 — "The Monolith"
 * Stripped to silence. One centred live timer, a hair-thin day line, a single
 * quiet "next" line, one centred start control (no FAB pair), and a closing
 * quote. Maximum negative space.
 */
export default function Test3Screen() {
  const {
    router, timer, now, colors: tc,
    categories, running, currentEntry, currentCategory,
    todayBlocks, nextBlock, timelineEntries, trackedMs, plannedMs, elapsed, quote,
    quickStartCategories, reviewCount,
  } = useHomeData()

  const secondEntry = running[1]
  const secondCategory = categories.find(c => c.id === secondEntry?.category_id)

  // ── State cards: show at most one calm prompt when something needs repair ──
  const nowMs = now.getTime()

  // Tracking gap — visible while idle AND while tracking: the hole is between
  // the last completed entry and (the running timer's start | now).
  const gapEndMs = currentEntry
    ? Math.min(new Date(currentEntry.start_time).getTime(), nowMs)
    : nowMs
  const lastEndMs = timelineEntries.reduce((max, e) => {
    if (!e.end_time) return max
    const end = new Date(e.end_time).getTime()
    return Number.isFinite(end) && end <= gapEndMs && end > max ? end : max
  }, 0)
  const gapMs = lastEndMs > 0 ? gapEndMs - lastEndMs : 0
  const showGapCard = gapMs >= GAP_CARD_MIN_MS

  // Plan drift: planned time that should already have happened vs tracked time.
  const plannedSoFarMs = todayBlocks.reduce((sum, b) => {
    const bs = new Date(b.start_time).getTime()
    const be = new Date(b.end_time).getTime()
    if (!Number.isFinite(bs) || !Number.isFinite(be)) return sum
    return sum + Math.max(0, Math.min(be, nowMs) - bs)
  }, 0)
  const driftMs = plannedSoFarMs - trackedMs
  const showDriftCard = !showGapCard && driftMs >= DRIFT_CARD_MIN_MS

  const openEntry = (entryId: string) =>
    router.push({
      pathname: '/(tabs)/day',
      params: { date: toLocalDateStr(new Date()), editEntry: entryId, focusTs: String(Date.now()) },
    })

  const pulseAnim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!currentEntry) { pulseAnim.setValue(1); return }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.7,  duration: 80,  useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.85, duration: 100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.4,  duration: 60,  useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 80,  useNativeDriver: true }),
        Animated.delay(513),
      ])
    )
    anim.start()
    return () => anim.stop()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEntry?.id])

  return (
    <View style={[styles.safe, { backgroundColor: tc.bg }]}>
      {/* Notification queue — quiet bell */}
      <Pressable
        onPress={() => router.push('/notifications')}
        style={styles.bell}
        hitSlop={12}
      >
        <Svg width={18} height={18} viewBox="0 0 16 16" fill="none">
          <Path
            d="M8 2.2c-2.3 0-3.7 1.7-3.7 3.9v2.3L3 10.7v.8h10v-.8l-1.3-2.3V6.1c0-2.2-1.4-3.9-3.7-3.9Z"
            stroke={tc.text4}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          <Path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0" stroke={tc.text4} strokeWidth={1.3} strokeLinecap="round" />
        </Svg>
      </Pressable>

      {/* Settings — off the tab bar, behind a quiet gear */}
      <Pressable
        onPress={() => router.push('/(tabs)/settings')}
        style={styles.gear}
        hitSlop={12}
      >
        <Svg width={18} height={18} viewBox="0 0 16 16" fill="none">
          <Path d="M2 5h12M2 11h12" stroke={tc.text4} strokeWidth={1.4} strokeLinecap="round" />
          <Circle cx={6} cy={5} r={2} fill={tc.bg} stroke={tc.text4} strokeWidth={1.4} />
          <Circle cx={10} cy={11} r={2} fill={tc.bg} stroke={tc.text4} strokeWidth={1.4} />
        </Svg>
      </Pressable>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.date, { color: tc.text3 }]}>
          {now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · {now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}
        </Text>

        {reviewCount > 0 && (
          <Pressable onPress={() => router.push('/review')} hitSlop={8} style={[styles.reviewPill, { borderColor: tc.border2 }]}>
            <Text style={[styles.reviewText, { color: tc.text2 }]}>
              {reviewCount} {reviewCount === 1 ? 'entry needs' : 'entries need'} review →
            </Text>
          </Pressable>
        )}

        {/* Centre stage */}
        {currentEntry ? (
          secondEntry ? (
            /* Two parallel tasks → A | B split (equal halves, divider between) */
            <View style={styles.splitRow}>
              <Pressable onPress={() => openEntry(currentEntry.id)} hitSlop={8} style={styles.splitStage}>
                <Text style={[styles.splitTimer, { color: tc.text1 }]} numberOfLines={1} adjustsFontSizeToFit>{formatElapsed(elapsed)}</Text>
                <View style={styles.catRow}>
                  <Animated.View style={[styles.dot, { backgroundColor: currentCategory?.color ?? tc.text3, transform: [{ scale: pulseAnim }] }]} />
                  <Text style={[styles.splitTask, { color: tc.text1 }]} numberOfLines={1}>{currentEntry.title}</Text>
                </View>
                <Text style={[styles.taskMeta, { color: tc.text3 }]} numberOfLines={1}>{currentCategory?.name?.toUpperCase()}</Text>
              </Pressable>
              <View style={[styles.splitDivider, { backgroundColor: tc.border }]} />
              <Pressable onPress={() => openEntry(secondEntry.id)} hitSlop={8} style={styles.splitStage}>
                <Text style={[styles.splitTimer, { color: tc.text1 }]} numberOfLines={1} adjustsFontSizeToFit>{formatElapsed(timer.elapsed[secondEntry.id] ?? 0)}</Text>
                <View style={styles.catRow}>
                  <Animated.View style={[styles.dot, { backgroundColor: secondCategory?.color ?? tc.text3, transform: [{ scale: pulseAnim }] }]} />
                  <Text style={[styles.splitTask, { color: tc.text1 }]} numberOfLines={1}>{secondEntry.title}</Text>
                </View>
                <Text style={[styles.taskMeta, { color: tc.text3 }]} numberOfLines={1}>{secondCategory?.name?.toUpperCase()}</Text>
              </Pressable>
            </View>
          ) : (
            /* Single live task → full-width centre stage. Tap to open in edit mode (#5) */
            <Pressable onPress={() => openEntry(currentEntry.id)} hitSlop={8} style={styles.stage}>
              <Text style={[styles.timer, { color: tc.text1 }]}>{formatElapsed(elapsed)}</Text>
              <View style={styles.catRow}>
                <Animated.View style={[styles.dot, { backgroundColor: currentCategory?.color ?? tc.text3, transform: [{ scale: pulseAnim }] }]} />
                <Text style={[styles.taskName, { color: tc.text1 }]} numberOfLines={1}>{currentEntry.title}</Text>
              </View>
              <Text style={[styles.taskMeta, { color: tc.text3 }]} numberOfLines={1}>
                {currentCategory?.name?.toUpperCase()}
              </Text>
            </Pressable>
          )
        ) : (
          <>
            <Text style={[styles.timerIdle, { color: tc.text4 }]}>idle</Text>
            <Text style={[styles.idleHint, { color: tc.text3 }]}>nothing tracking</Text>
          </>
        )}

        {/* Hair-thin day line */}
        <View style={styles.dayLineWrap}>
          <DayLine entries={timelineEntries} categories={categories} now={now} trackColor={tc.border} nowColor={tc.text1} fallback={tc.text3} />
          <Text style={[styles.dayStat, { color: tc.text3 }]}>
            {plannedMs > 0 ? `${formatHours(trackedMs)} of ${formatHours(plannedMs)} h planned` : `${formatHours(trackedMs)} h tracked`}
          </Text>
        </View>

        {/* State cards — at most one calm prompt */}
        {showGapCard && (
          <Pressable
            onPress={() => router.push({
              pathname: '/(tabs)/day',
              params: {
                sheet: 'gap',
                gapStart: new Date(lastEndMs).toISOString(),
                gapEnd: new Date(gapEndMs).toISOString(),
                focusTs: String(Date.now()),
              },
            })}
            style={[styles.stateCard, { borderColor: tc.border2 }]}
          >
            <Text style={[styles.stateCardText, { color: tc.text2 }]}>
              {fmtDurationShort(gapMs)} untracked since {new Date(lastEndMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </Text>
            <Text style={[styles.stateCardAction, { color: tc.text3 }]}>Fill it in →</Text>
          </Pressable>
        )}
        {showDriftCard && (
          <Pressable
            onPress={() => router.push('/(tabs)/plan')}
            style={[styles.stateCard, { borderColor: tc.border2 }]}
          >
            <Text style={[styles.stateCardText, { color: tc.text2 }]}>
              Plan is about {fmtDurationShort(driftMs)} behind
            </Text>
            <Text style={[styles.stateCardAction, { color: tc.text3 }]}>Replan with Agent →</Text>
          </Pressable>
        )}

        {/* One quiet next line */}
        {nextBlock && (
          <Pressable
            onPress={() => timer.start({ categoryId: nextBlock.category_id, title: nextBlock.title, tags: nextBlock.tags, todoId: nextBlock.todo_id, calendarBlockId: nextBlock.id })}
            hitSlop={8}
            style={styles.nextLine}
          >
            <Text style={[styles.nextText, { color: tc.text3 }]}>
              next · <Text style={{ color: tc.text2 }}>{nextBlock.title}</Text> · {relativeTime(nextBlock.start_time, now)}
            </Text>
          </Pressable>
        )}

        {/* Quick-start category chips */}
        {quickStartCategories.length > 0 && (
          <View style={styles.quickStartRow}>
            {quickStartCategories.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => timer.start({ categoryId: cat.id, title: cat.name, tags: [] })}
                hitSlop={8}
                style={styles.quickChip}
              >
                <View style={[styles.chipDot, { backgroundColor: cat.color }]} />
                <Text style={[styles.chipLabel, { color: tc.text2 }]} numberOfLines={1}>{cat.name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Single centred control: stop the running task, or start a new one when idle */}
        {currentEntry ? (
          <Pressable
            style={[styles.startCircle, { borderColor: tc.text2 }]}
            onPress={() => timer.stopAll()}
            accessibilityLabel="Stop current timer"
          >
            <View style={[styles.stopSquare, { backgroundColor: tc.text1 }]} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.startCircle, { borderColor: tc.text2 }]}
            onPress={() => router.push({ pathname: '/(tabs)/day', params: { sheet: 'entry' } })}
            accessibilityLabel="Start a new timer"
          >
            <Text style={{ color: tc.text1, fontSize: 28, lineHeight: 30, fontWeight: '300' }}>+</Text>
          </Pressable>
        )}

        {/* Quote */}
        <View style={styles.quoteWrap}>
          <Text style={[styles.quoteText, { color: tc.text3 }]}>{quote.text}</Text>
          <Text style={[styles.quoteAuthor, { color: tc.text4 }]}>— {quote.author}</Text>
        </View>
      </ScrollView>
    </View>
  )
}

interface DayLineProps {
  entries: TimeEntry[]
  categories: Category[]
  now: Date
  trackColor: string
  nowColor: string
  fallback: string
}

/** A hair-thin 24-hour line: coloured marks for tracked time + a now dot. */
function DayLine({ entries, categories, now, trackColor, nowColor, fallback }: DayLineProps) {
  const dayKey = toLocalDateStr(now)
  const [year, month, day] = dayKey.split('-').map(Number)
  const dayStartMs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
  const dayEndMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
  const nowMs = now.getTime()
  const pctAt = (ms: number): number => ((ms - dayStartMs) / (dayEndMs - dayStartMs)) * 100
  const nowPct = pctAt(nowMs)

  return (
    <View style={[styles.dayLine, { backgroundColor: trackColor }]}>
      {entries.map(entry => {
        const startMs = new Date(entry.start_time).getTime()
        const endMs = entry.end_time ? new Date(entry.end_time).getTime() : nowMs
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
        const clampedStart = Math.max(startMs, dayStartMs)
        const clampedEnd = Math.min(endMs, nowMs, dayEndMs)
        if (clampedEnd <= clampedStart) return null
        const color = categories.find(c => c.id === entry.category_id)?.color ?? fallback
        return (
          <View
            key={entry.id}
            style={[styles.mark, { left: `${pctAt(clampedStart)}%`, width: `${Math.max(pctAt(clampedEnd) - pctAt(clampedStart), 0.4)}%`, backgroundColor: color }]}
          />
        )
      })}
      <View style={[styles.nowDot, { left: `${nowPct}%`, backgroundColor: nowColor }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 32, paddingTop: 72, paddingBottom: 48 },

  date: { fontSize: 10.5, letterSpacing: 2.5, fontFamily: fonts.ui, fontWeight: '500', marginBottom: 36 },

  reviewPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, marginBottom: 28, marginTop: -12 },
  reviewText: { fontSize: 12.5, letterSpacing: 0.3, fontFamily: fonts.ui },

  timer: { fontSize: 68, lineHeight: 70, letterSpacing: -2.5, fontFamily: fonts.displayBold, fontVariant: ['tabular-nums'] },
  timerIdle: { fontSize: 52, letterSpacing: -1.5, fontFamily: fonts.displayItalic },
  idleHint: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 10, letterSpacing: 0.5 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  catName: { fontSize: 12, letterSpacing: 2.5, fontFamily: fonts.ui, fontWeight: '600' },

  stage: { alignItems: 'center' },
  taskName: { fontSize: 19, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2, maxWidth: 300 },
  taskMeta: { fontSize: 11, letterSpacing: 1.5, fontFamily: fonts.ui, fontWeight: '500', marginTop: 8 },

  // Two parallel tasks: A | B split (equal halves with a vertical divider)
  splitRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', alignSelf: 'stretch' },
  splitStage: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  splitTimer: { fontSize: 40, lineHeight: 46, letterSpacing: -1.5, fontFamily: fonts.displayBold, fontVariant: ['tabular-nums'], maxWidth: '100%' },
  splitTask: { fontSize: 15, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2, maxWidth: 130 },
  splitDivider: { width: 1, alignSelf: 'stretch', minHeight: 96, marginHorizontal: 6 },

  dayLineWrap: { width: '100%', alignItems: 'center', marginTop: 48 },
  dayLine: { width: '100%', height: 3, borderRadius: 1.5, position: 'relative' },
  mark: { position: 'absolute', top: 0, bottom: 0, borderRadius: 1.5, minWidth: 2 },
  nowDot: { position: 'absolute', top: -2.5, width: 8, height: 8, borderRadius: 4, marginLeft: -4 },
  dayStat: { fontSize: 11, letterSpacing: 1, fontFamily: fonts.ui, marginTop: 16, fontVariant: ['tabular-nums'] },

  nextLine: { marginTop: 44 },
  nextText: { fontSize: 13.5, letterSpacing: 0.3, fontFamily: fonts.ui },

  gear: { position: 'absolute', top: 16, right: 20, zIndex: 10, padding: 4 },
  bell: { position: 'absolute', top: 16, left: 20, zIndex: 10, padding: 4 },
  stateCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginTop: 32,
  },
  stateCardText: { fontSize: 13, fontFamily: fonts.ui, letterSpacing: 0.2 },
  stateCardAction: { fontSize: 12, fontFamily: fonts.ui },

  quickStartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 20, marginTop: 36 },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 12, letterSpacing: 0.5, fontFamily: fonts.ui },

  startCircle: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginTop: 44,
  },
  stopSquare: { width: 18, height: 18, borderRadius: 3 },
  quoteWrap: { marginTop: 56, alignItems: 'center', paddingHorizontal: 8 },
  quoteText: { fontSize: 16, lineHeight: 25, fontFamily: fonts.displayItalic, textAlign: 'center', letterSpacing: -0.1 },
  quoteAuthor: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontFamily: fonts.ui, marginTop: 14 },
})
