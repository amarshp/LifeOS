import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import * as brainService from '../src/services/brain'
import type { Concern, BrainRun } from '../src/services/brain'

// "What LifeOS is watching" — the brain's open concerns with their evidence,
// what it last did about each, and the run log of why it acted or stayed quiet.

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function BrainScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [runs, setRuns] = useState<BrainRun[]>([])

  const load = useCallback(() => {
    brainService.getConcerns().then(setConcerns).catch(() => {})
    brainService.getRecentRuns().then(setRuns).catch(() => {})
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const dismiss = useCallback(async (c: Concern) => {
    setConcerns(prev => prev.map(x => (x.id === c.id ? { ...x, status: 'dismissed' as const } : x)))
    try { await brainService.dismissConcern(c.id) } catch { load() }
  }, [load])

  const open = concerns.filter(c => c.status === 'open')
  const closed = concerns.filter(c => c.status !== 'open').slice(0, 10)

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Watching</Text>
        <Text style={[styles.count, { color: tc.text3 }]}>{open.length || ''}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {open.length === 0 && (
          <Text style={[styles.empty, { color: tc.text4 }]}>
            Nothing needs attention right now.
          </Text>
        )}
        {open.map(c => (
          <View key={c.id} style={[styles.card, { backgroundColor: tc.surface1, borderColor: tc.border }]}>
            <View style={styles.cardTop}>
              <Text style={[styles.cardTitle, { color: tc.text1 }]}>{c.title}</Text>
              <Pressable onPress={() => dismiss(c)} hitSlop={10}>
                <Text style={{ color: tc.text4, fontSize: 12 }}>✕</Text>
              </Pressable>
            </View>
            {c.detail && <Text style={[styles.cardDetail, { color: tc.text2 }]}>{c.detail}</Text>}
            {c.evidence && <Text style={[styles.cardEvidence, { color: tc.text4 }]}>{c.evidence}</Text>}
            <Text style={[styles.cardMeta, { color: tc.text4 }]}>
              {c.kind} · {c.last_action ? `${c.last_action} ${c.last_action_at ? ago(c.last_action_at) : ''}` : 'no action yet'}
              {c.notified_count > 0 ? ` · notified ×${c.notified_count}` : ''}
            </Text>
          </View>
        ))}

        {closed.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: tc.text3 }]}>Recently closed</Text>
            {closed.map(c => (
              <View key={c.id} style={[styles.closedRow, { borderBottomColor: tc.border }]}>
                <Text style={[styles.closedTitle, { color: tc.text3 }]} numberOfLines={1}>{c.title}</Text>
                <Text style={[styles.closedMeta, { color: tc.text4 }]}>{c.status}{c.resolution ? ` · ${c.resolution}` : ''}</Text>
              </View>
            ))}
          </>
        )}

        {runs.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: tc.text3 }]}>Recent decisions</Text>
            {runs.map(r => (
              <View key={r.id} style={[styles.runRow, { borderBottomColor: tc.border }]}>
                <Text style={[styles.runMeta, { color: tc.text4 }]}>{ago(r.created_at)} · {r.trigger}</Text>
                <Text style={[styles.runSummary, { color: tc.text3 }]}>{r.summary}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  backText: { fontSize: 14, fontFamily: fonts.ui },
  title: { fontSize: 24, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.4, flex: 1 },
  count: { fontSize: 14, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] },

  scroll: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 60 },
  empty: { fontSize: 13, fontFamily: fonts.ui, paddingTop: 40, textAlign: 'center' },

  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', fontFamily: fonts.displaySemiBold, letterSpacing: -0.2, flex: 1 },
  cardDetail: { fontSize: 13, fontFamily: fonts.ui, marginTop: 5, lineHeight: 18 },
  cardEvidence: { fontSize: 11.5, fontFamily: fonts.ui, marginTop: 6, fontStyle: 'italic' },
  cardMeta: { fontSize: 11, fontFamily: fonts.ui, marginTop: 8 },

  sectionLabel: {
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
    marginTop: 26,
    marginBottom: 8,
  },
  closedRow: { paddingVertical: 9, borderBottomWidth: 1, gap: 2 },
  closedTitle: { fontSize: 13.5, fontFamily: fonts.ui },
  closedMeta: { fontSize: 11, fontFamily: fonts.ui },
  runRow: { paddingVertical: 9, borderBottomWidth: 1, gap: 3 },
  runMeta: { fontSize: 11, fontFamily: fonts.ui },
  runSummary: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 17 },
})
