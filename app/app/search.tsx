import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import { formatClock12 } from '../src/lib/format'
import { toLocalDateStr } from '../src/lib/date'
import * as categoriesService from '../src/services/categories'
import * as timeEntriesService from '../src/services/time-entries'
import type { Category, TimeEntry } from '../src/types/database'

// Global entry search: text match on title + optional category filter, across
// all days. Tap a result to edit it in the Day view.
export default function SearchScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [results, setResults] = useState<TimeEntry[]>([])

  useFocusEffect(useCallback(() => {
    categoriesService.getCategories().then(setCategories).catch(() => {})
  }, []))

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 220)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    timeEntriesService.searchEntries({ query: debounced, categoryId })
      .then(setResults)
      .catch(() => setResults([]))
  }, [debounced, categoryId])

  const openEntry = (entryId: string) =>
    router.push({
      pathname: '/(tabs)/day',
      params: { date: toLocalDateStr(new Date()), editEntry: entryId, focusTs: String(Date.now()) },
    })

  const hasFilter = debounced.trim().length > 0 || categoryId !== null

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Search</Text>
      </View>

      <View style={[styles.searchBox, { backgroundColor: tc.surface2, borderColor: tc.border }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search entries…"
          placeholderTextColor={tc.text4}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: tc.text1 }]}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Text style={[styles.clear, { color: tc.text3 }]}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        <FilterChip label="All" active={categoryId === null} color={tc.text3} onPress={() => setCategoryId(null)} tc={tc} />
        {categories.map((c) => (
          <FilterChip key={c.id} label={c.name} active={categoryId === c.id} color={c.color} onPress={() => setCategoryId(c.id)} tc={tc} />
        ))}
      </ScrollView>

      {results.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: tc.text3 }]}>{hasFilter ? 'No matches' : 'Recent entries'}</Text>
          {!hasFilter && <Text style={[styles.emptyHint, { color: tc.text4 }]}>Type to search by title, or filter by category</Text>}
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {results.map((entry) => {
            const cat = categories.find((c) => c.id === entry.category_id)
            const tags = entry.tags.filter((t) => t !== 'review')
            const dateStr = new Date(entry.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <Pressable key={entry.id} onPress={() => openEntry(entry.id)} style={[styles.card, { backgroundColor: tc.surface2, borderColor: tc.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.dot, { backgroundColor: cat?.color ?? tc.text3 }]} />
                  <Text style={[styles.cardTitle, { color: tc.text1 }]} numberOfLines={1}>{entry.title}</Text>
                  {entry.is_running && <Text style={[styles.live, { color: cat?.color ?? tc.text3 }]}>● live</Text>}
                </View>
                <Text style={[styles.meta, { color: tc.text3 }]} numberOfLines={1}>
                  {cat?.name ?? 'Uncategorized'} · {dateStr} · {formatClock12(entry.start_time)}
                  {entry.end_time ? `–${formatClock12(entry.end_time)}` : ''}
                  {tags.length > 0 ? `  ${tags.map((t) => `#${t}`).join(' ')}` : ''}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

interface FilterChipProps {
  label: string
  active: boolean
  color: string
  onPress: () => void
  tc: ReturnType<typeof useSettings>['colors']
}

function FilterChip({ label, active, color, onPress, tc }: FilterChipProps) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={[styles.chip, { borderColor: active ? tc.border3 : tc.border, backgroundColor: active ? tc.surface3 : 'transparent' }]}>
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipLabel, { color: active ? tc.text1 : tc.text3 }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  back: { position: 'absolute', left: 20, top: 6, zIndex: 1 },
  backText: { fontSize: 15, fontFamily: fonts.ui },
  title: { flex: 1, textAlign: 'center', fontSize: 20, fontFamily: fonts.displaySemiBold, fontWeight: '600' },

  searchBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, fontSize: 15, fontFamily: fonts.ui, paddingVertical: 12 },
  clear: { fontSize: 14, paddingLeft: 10 },

  chipScroll: { flexGrow: 0, marginTop: 12 },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 12.5, fontFamily: fonts.ui, maxWidth: 120 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80, gap: 8 },
  emptyText: { fontSize: 15, fontFamily: fonts.displayItalic },
  emptyHint: { fontSize: 12, fontFamily: fonts.ui, textAlign: 'center', paddingHorizontal: 48 },

  scroll: { flex: 1, marginTop: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontSize: 15.5, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2 },
  live: { fontSize: 11, fontFamily: fonts.ui, fontWeight: '600' },
  meta: { fontSize: 12.5, fontFamily: fonts.ui },
})
