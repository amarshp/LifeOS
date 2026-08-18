import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import {
  getGymFrequencyTrend, getDaysSinceLastSleep, getRecentNudgeOutcomes, getSleepGymCorrelation, getPulseInsights,
  type WeekBucket, type NudgeOutcome, type CorrelationResult, type InsightCard,
} from '../src/services/lifeSignals'

// Pulse — the calm counterpart to /insights. Insights answers "did I track
// accurately"; this answers "is anything actually worth knowing." Only real
// signal renders — no section renders a placeholder for data that isn't there
// yet (PLANNING_MODE_SPEC.md §13c).

const SLEEP_QUIET_DAYS = 3

function weekLabel(monday: string): string {
  const d = new Date(monday + 'T00:00:00Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

// The same nudge (e.g. "No plan for today yet") resolving the same way on
// repeated mornings produced 4-5 visually-identical rows with nothing to
// distinguish them — collapsed into one row with a count and the most
// recent date, since the repetition itself ("this keeps happening") is the
// only real information in that case.
function collapseOutcomes(outcomes: NudgeOutcome[]): Array<NudgeOutcome & { count: number }> {
  const out: Array<NudgeOutcome & { count: number }> = []
  for (const o of outcomes) {
    const prev = out[out.length - 1]
    if (prev && prev.title === o.title && prev.resolution === o.resolution) {
      prev.count += 1
      continue
    }
    out.push({ ...o, count: 1 })
  }
  return out
}

export default function PulseScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [gymWeeks, setGymWeeks] = useState<WeekBucket[]>([])
  const [sleepQuietDays, setSleepQuietDays] = useState<number | null>(null)
  const [outcomes, setOutcomes] = useState<NudgeOutcome[]>([])
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null)
  const [insightCards, setInsightCards] = useState<InsightCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [insightsLoaded, setInsightsLoaded] = useState(false)

  const load = useCallback(() => {
    // Insights fetch on its own, not in the Promise.all below — it can take
    // up to 45s (one LLM call server-side); bundling it meant the fast,
    // always-instant cards (gym/sleep/correlation) went blank right along
    // with it (Codex catch). They now render the moment they're ready,
    // independent of how long the LLM call takes.
    setInsightsLoaded(false)
    getPulseInsights().then((cards) => {
      setInsightCards(cards)
      setInsightsLoaded(true)
    }).catch(() => setInsightsLoaded(true))

    Promise.all([
      getGymFrequencyTrend(56),
      getDaysSinceLastSleep(),
      getRecentNudgeOutcomes(30),
      getSleepGymCorrelation(90),
    ]).then(([weeks, quiet, outs, corr]) => {
      setGymWeeks(weeks)
      setSleepQuietDays(quiet)
      setOutcomes(outs)
      setCorrelation(corr)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const showSleepQuiet = sleepQuietDays !== null && sleepQuietDays >= SLEEP_QUIET_DAYS
  // Zero-filled weeks (Codex catch) make a real gap visible — but an all-zero
  // series isn't signal, it's "never logged," which isn't worth a card.
  const showGymTrend = gymWeeks.some(w => w.count > 0)
  const showOutcomes = outcomes.length > 0
  const showCorrelation = correlation !== null
  // Waits on both fast + insight loads before declaring "nothing" (so a slow
  // insights call doesn't get preempted by a premature empty state) — but
  // that wait never blocks the fast cards themselves from rendering above.
  const nothingToShow = loaded && insightsLoaded && !showSleepQuiet && !showGymTrend && !showOutcomes && !showCorrelation && insightCards.length === 0
  const maxCount = Math.max(1, ...gymWeeks.map(w => w.count))

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Pulse</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {nothingToShow && (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: tc.text3 }]}>Nothing notable yet</Text>
            <Text style={[styles.emptyHint, { color: tc.text4 }]}>
              This page fills in as patterns show up in what you track
            </Text>
          </View>
        )}

        {showSleepQuiet && (
          <View style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>SLEEP LOGGING</Text>
            <Text style={[styles.cardText, { color: tc.text1 }]}>
              {sleepQuietDays} days since a sleep entry was logged
            </Text>
            <Text style={[styles.cardSub, { color: tc.text3 }]}>
              Nothing else on this page can account for sleep until this picks back up
            </Text>
          </View>
        )}

        {showGymTrend && (
          <View style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>GYM, LAST 8 WEEKS</Text>
            <View style={styles.sparkRow}>
              {gymWeeks.map(w => (
                <View key={w.weekStart} style={styles.sparkCol}>
                  <View style={styles.sparkTrack}>
                    <View style={[styles.sparkBar, { height: `${(w.count / maxCount) * 100}%`, backgroundColor: tc.text2, opacity: w.isCurrent ? 0.4 : 1 }]} />
                  </View>
                  <Text style={[styles.sparkCount, { color: tc.text1 }]}>{w.count}</Text>
                  <Text style={[styles.sparkLabel, { color: tc.text4 }]}>{w.isCurrent ? 'so far' : weekLabel(w.weekStart)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {showCorrelation && correlation && (
          <View style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>PATTERN</Text>
            <Text style={[styles.cardText, { color: tc.text1 }]}>{correlation.label}</Text>
            <Text style={[styles.cardSub, { color: tc.text3 }]}>
              Based on {correlation.n} nights · {'★'.repeat(correlation.confidenceStars)}{'☆'.repeat(5 - correlation.confidenceStars)} confidence · not a cause, just a pattern
            </Text>
          </View>
        )}

        {insightCards.map((c, i) => (
          <View key={`${c.category}-${i}`} style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>{c.category.toUpperCase()}</Text>
            <Text style={[styles.cardText, { color: tc.text1 }]}>{c.headline}</Text>
            <Text style={[styles.cardSub, { color: tc.text3 }]}>{c.detail}</Text>
          </View>
        ))}

        {showOutcomes && (
          <View style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>DID IT WORK</Text>
            <Text style={[styles.cardSub, { color: tc.text3, marginTop: 2, marginBottom: 4 }]}>
              Nudges that actually pushed to your phone, and what happened after.
            </Text>
            {collapseOutcomes(outcomes).map(o => (
              <View key={o.id} style={styles.outcomeRow}>
                <Text style={[styles.outcomeTitle, { color: tc.text1 }]} numberOfLines={1}>
                  {o.title}{o.count > 1 ? ` (×${o.count})` : ''}
                </Text>
                <Text style={[styles.outcomeText, { color: tc.text3 }]}>{o.resolution} · {ago(o.updated_at)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 },
  back: { paddingRight: 2 },
  backText: { fontSize: 14, fontFamily: fonts.ui },
  title: { fontSize: 24, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.4, flex: 1 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 60, gap: 16 },

  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, fontFamily: fonts.displaySemiBold },
  emptyHint: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 6 },
  cardLabel: { fontSize: 10.5, letterSpacing: 1.5, fontFamily: fonts.ui, fontWeight: '600' },
  cardText: { fontSize: 15, fontFamily: fonts.displaySemiBold, letterSpacing: -0.1, lineHeight: 21 },
  cardSub: { fontSize: 12, fontFamily: fonts.ui, lineHeight: 17 },

  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6, height: 78 },
  sparkCol: { alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' },
  sparkTrack: { width: 10, height: 44, justifyContent: 'flex-end' },
  sparkBar: { width: 10, borderRadius: 3, minHeight: 2 },
  sparkCount: { fontSize: 11, fontFamily: fonts.ui, marginTop: 4, fontVariant: ['tabular-nums'] },
  sparkLabel: { fontSize: 9, fontFamily: fonts.ui, marginTop: 2 },

  outcomeRow: { paddingVertical: 6 },
  outcomeTitle: { fontSize: 13.5, fontFamily: fonts.ui, fontWeight: '600' },
  outcomeText: { fontSize: 12, fontFamily: fonts.ui, marginTop: 2, lineHeight: 16 },
})
