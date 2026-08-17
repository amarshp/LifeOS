import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import {
  getGymFrequencyTrend, getDaysSinceLastSleep, getRecentNudgeOutcomes, getSleepGymCorrelation,
  type WeekBucket, type NudgeOutcome, type CorrelationResult,
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

export default function PulseScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [gymWeeks, setGymWeeks] = useState<WeekBucket[]>([])
  const [sleepQuietDays, setSleepQuietDays] = useState<number | null>(null)
  const [outcomes, setOutcomes] = useState<NudgeOutcome[]>([])
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
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
  const nothingToShow = loaded && !showSleepQuiet && !showGymTrend && !showOutcomes && !showCorrelation
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

        {showOutcomes && (
          <View style={[styles.card, { borderColor: tc.border2 }]}>
            <Text style={[styles.cardLabel, { color: tc.text3 }]}>DID IT WORK</Text>
            {outcomes.map(o => (
              <View key={o.id} style={styles.outcomeRow}>
                <Text style={[styles.outcomeTitle, { color: tc.text1 }]} numberOfLines={1}>{o.title}</Text>
                <Text style={[styles.outcomeText, { color: tc.text3 }]}>{o.resolution}</Text>
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
