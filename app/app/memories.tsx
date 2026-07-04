import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import * as memoriesService from '../src/services/memories'
import type { AgentMemory } from '../src/services/memories'

// What the agent knows about you — every durable memory, inspectable.
// Pin what matters, forget what's wrong, add facts directly.

export default function MemoriesScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    memoriesService.getMemories().then(setMemories).catch(() => {})
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const add = useCallback(async () => {
    const content = input.trim()
    if (!content || saving) return
    setSaving(true)
    try {
      await memoriesService.addMemory(content)
      setInput('')
      load()
    } catch {
      // row simply doesn't appear — keep the text so the user can retry
    } finally {
      setSaving(false)
    }
  }, [input, saving, load])

  const togglePin = useCallback(async (m: AgentMemory) => {
    setMemories(prev => prev.map(x => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)))
    try { await memoriesService.setPinned(m.id, !m.pinned) } catch { load() }
  }, [load])

  const forget = useCallback(async (m: AgentMemory) => {
    setMemories(prev => prev.filter(x => x.id !== m.id))
    try { await memoriesService.forgetMemory(m.id) } catch { load() }
  }, [load])

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Memories</Text>
        <Text style={[styles.count, { color: tc.text3 }]}>{memories.length || ''}</Text>
      </View>
      <Text style={[styles.hint, { color: tc.text4 }]}>
        What the agent knows about you. It only saves here with your ok.
      </Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {memories.length === 0 && (
          <Text style={[styles.empty, { color: tc.text4 }]}>
            Nothing yet — tell the agent “remember that …” or add a fact below.
          </Text>
        )}
        {memories.map(m => (
          <View key={m.id} style={[styles.row, { borderBottomColor: tc.border }]}>
            <View style={styles.rowMain}>
              <Text style={[styles.rowContent, { color: tc.text1 }]}>{m.content}</Text>
              <Text style={[styles.rowMeta, { color: tc.text4 }]}>
                {m.kind}{m.source === 'agent' ? ' · saved by agent' : ''}
              </Text>
            </View>
            <Pressable onPress={() => togglePin(m)} hitSlop={10} style={styles.rowBtn}>
              <Text style={{ color: m.pinned ? tc.text1 : tc.text4, fontSize: 14 }}>{m.pinned ? '★' : '☆'}</Text>
            </Pressable>
            <Pressable onPress={() => forget(m)} hitSlop={10} style={styles.rowBtn}>
              <Text style={{ color: tc.text4, fontSize: 12 }}>✕</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.inputBar, { borderTopColor: tc.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: tc.surface1, color: tc.text1, borderColor: tc.border }]}
          placeholder="Add a fact the agent should know…"
          placeholderTextColor={tc.text4}
          value={input}
          onChangeText={setInput}
          editable={!saving}
          onSubmitEditing={add}
          returnKeyType="done"
        />
      </View>
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
    paddingBottom: 4,
  },
  backText: { fontSize: 14, fontFamily: fonts.ui },
  title: { fontSize: 24, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.4, flex: 1 },
  count: { fontSize: 14, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, fontFamily: fonts.ui, paddingHorizontal: 20, paddingBottom: 10 },

  scroll: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  empty: { fontSize: 13, fontFamily: fonts.ui, paddingTop: 40, textAlign: 'center', lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  rowContent: { fontSize: 14.5, fontFamily: fonts.ui, lineHeight: 20 },
  rowMeta: { fontSize: 11, fontFamily: fonts.ui },
  rowBtn: { padding: 4 },

  inputBar: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 26, borderTopWidth: 1 },
  input: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 14.5,
    fontFamily: fonts.ui,
  },
})
