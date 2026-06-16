import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import { formatClock12 } from '../src/lib/format'
import { toLocalDateStr } from '../src/lib/date'
import { emitTimerChange } from '../src/lib/timer-events'
import * as categoriesService from '../src/services/categories'
import * as timeEntriesService from '../src/services/time-entries'
import type { Category, TimeEntry } from '../src/types/database'

// Triage queue for `review`-tagged voice/Siri entries (often mis-heard). Each
// row opens the full edit sheet (Day view) or clears the tag in one tap.
export default function ReviewScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const load = useCallback(() => {
    Promise.all([
      timeEntriesService.getEntriesNeedingReview(),
      categoriesService.getCategories(),
    ])
      .then(([e, c]) => { setEntries(e); setCategories(c) })
      .catch(() => {})
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const markReviewed = useCallback(async (entry: TimeEntry) => {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id)) // optimistic
    try {
      await timeEntriesService.clearReviewTag(entry.id, entry.tags)
      emitTimerChange()
    } catch {
      load() // revert on failure
    }
  }, [load])

  const openEntry = (entryId: string) =>
    router.push({
      pathname: '/(tabs)/day',
      params: { date: toLocalDateStr(new Date()), editEntry: entryId, focusTs: String(Date.now()) },
    })

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Review</Text>
        <Text style={[styles.count, { color: tc.text3 }]}>{entries.length || ''}</Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyMark, { color: tc.text4 }]}>✓</Text>
          <Text style={[styles.emptyText, { color: tc.text3 }]}>Nothing to review</Text>
          <Text style={[styles.emptyHint, { color: tc.text4 }]}>Voice entries that may be mis-heard show up here</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {entries.map((entry) => {
            const cat = categories.find((c) => c.id === entry.category_id)
            const visibleTags = entry.tags.filter((t) => t !== 'review')
            const dateStr = new Date(entry.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <View key={entry.id} style={[styles.card, { backgroundColor: tc.surface2, borderColor: tc.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.dot, { backgroundColor: cat?.color ?? tc.text3 }]} />
                  <Text style={[styles.cardTitle, { color: tc.text1 }]} numberOfLines={1}>{entry.title}</Text>
                  {entry.is_running && <Text style={[styles.live, { color: cat?.color ?? tc.text3 }]}>● live</Text>}
                </View>
                <Text style={[styles.meta, { color: tc.text3 }]} numberOfLines={1}>
                  {cat?.name ?? 'Uncategorized'} · {dateStr} · {formatClock12(entry.start_time)}
                  {entry.end_time ? `–${formatClock12(entry.end_time)}` : ''}
                </Text>
                {visibleTags.length > 0 && (
                  <Text style={[styles.tags, { color: tc.text4 }]} numberOfLines={1}>{visibleTags.map((t) => `#${t}`).join(' ')}</Text>
                )}
                <View style={styles.actions}>
                  <Pressable onPress={() => openEntry(entry.id)} hitSlop={8} style={[styles.btn, { borderColor: tc.border2 }]}>
                    <Text style={[styles.btnText, { color: tc.text2 }]}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => markReviewed(entry)} hitSlop={8} style={[styles.btn, styles.btnPrimary, { borderColor: tc.border3 }]}>
                    <Text style={[styles.btnText, { color: tc.text1 }]}>✓ Reviewed</Text>
                  </Pressable>
                </View>
              </View>
            )
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  back: { position: 'absolute', left: 20, top: 6, zIndex: 1 },
  backText: { fontSize: 15, fontFamily: fonts.ui },
  title: { flex: 1, textAlign: 'center', fontSize: 20, fontFamily: fonts.displaySemiBold, fontWeight: '600' },
  count: { position: 'absolute', right: 20, top: 8, fontSize: 15, fontVariant: ['tabular-nums'], fontFamily: fonts.ui },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80, gap: 10 },
  emptyMark: { fontSize: 44, fontWeight: '300' },
  emptyText: { fontSize: 16, fontFamily: fonts.displayItalic },
  emptyHint: { fontSize: 12, fontFamily: fonts.ui, textAlign: 'center', paddingHorizontal: 48, lineHeight: 18 },

  scroll: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2 },
  live: { fontSize: 11, fontFamily: fonts.ui, fontWeight: '600' },
  meta: { fontSize: 12.5, fontFamily: fonts.ui },
  tags: { fontSize: 12, fontFamily: fonts.ui },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  btn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  btnPrimary: { borderWidth: 1.5 },
  btnText: { fontSize: 13, fontFamily: fonts.ui, fontWeight: '500' },
})
