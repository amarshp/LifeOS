import { useEffect, useState } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'
import type { Category, Todo, TodoPriority, RecurrenceType, TodoStep } from '../types/database'
import { todayStr } from '../lib/date'
import { addLocalDays } from '../lib/time-range'
import * as todosService from '../services/todos'

interface TodoEditorSheetProps {
  visible: boolean
  todo: Todo | null // null = create
  categories: Category[]
  colors: ColorPalette
  onClose: () => void
  onSaved: () => void
}

type LocalStep = { id?: string; title: string; done: boolean }

const PRIORITIES: { value: TodoPriority; label: string; color: string }[] = [
  { value: 0, label: 'None', color: '#7A766C' },
  { value: 1, label: 'Low', color: '#8BB4CC' },
  { value: 2, label: 'Med', color: '#CCAA6B' },
  { value: 3, label: 'High', color: '#C8102E' },
]

const RECURRENCES: { value: RecurrenceType; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'mwf', label: 'M W F' },
  { value: 'weekly', label: 'Weekly' },
]

// Relative deadline chips → ISO at local end-of-day, or null.
function deadlineChips(): { label: string; date: string | null }[] {
  return [
    { label: 'None', date: null },
    { label: 'Today', date: todayStr() },
    { label: 'Tomorrow', date: addLocalDays(todayStr(), 1) },
    { label: '+3 days', date: addLocalDays(todayStr(), 3) },
    { label: 'Next week', date: addLocalDays(todayStr(), 7) },
  ]
}

function dateToEndOfDayIso(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 0, 0).toISOString()
}

export function TodoEditorSheet({ visible, todo, categories, colors: tc, onClose, onSaved }: TodoEditorSheetProps) {
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [priority, setPriority] = useState<TodoPriority>(0)
  const [deadlineDate, setDeadlineDate] = useState<string | null>(null)
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none')
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState<LocalStep[]>([])
  const [originalSteps, setOriginalSteps] = useState<TodoStep[]>([])
  const [stepInput, setStepInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (todo) {
      setTitle(todo.title)
      setCategoryId(todo.category_id)
      setPriority(todo.priority)
      setDeadlineDate(todo.deadline ? todo.deadline.slice(0, 10) : null)
      setRecurrence(todo.recurrence)
      setNotes(todo.notes ?? '')
      todosService.getStepsForTodos([todo.id]).then((s) => {
        setOriginalSteps(s)
        setSteps(s.map((x) => ({ id: x.id, title: x.title, done: x.done })))
      }).catch(() => {})
    } else {
      setTitle(''); setCategoryId(null); setPriority(0); setDeadlineDate(null)
      setRecurrence('none'); setNotes(''); setSteps([]); setOriginalSteps([]); setStepInput('')
    }
  }, [visible, todo])

  const addStep = () => {
    const t = stepInput.trim()
    if (!t) return
    setSteps((prev) => [...prev, { title: t, done: false }])
    setStepInput('')
  }

  const reconcileSteps = async (todoId: string) => {
    // delete removed
    for (const orig of originalSteps) {
      if (!steps.some((s) => s.id === orig.id)) await todosService.deleteStep(orig.id)
    }
    let order = 0
    for (const s of steps) {
      if (s.id) {
        const orig = originalSteps.find((o) => o.id === s.id)
        if (orig && (orig.title !== s.title || orig.done !== s.done || orig.sort_order !== order)) {
          await todosService.updateStep(s.id, { title: s.title, done: s.done, sort_order: order })
        }
      } else {
        await todosService.addStep({ todo_id: todoId, title: s.title, done: s.done, sort_order: order })
      }
      order++
    }
  }

  const save = async () => {
    const t = title.trim()
    if (!t) { Alert.alert('Task', 'Give the task a title.'); return }
    setSaving(true)
    try {
      const deadline = recurrence === 'none' && deadlineDate ? dateToEndOfDayIso(deadlineDate) : null
      if (todo) {
        await todosService.updateTodo(todo.id, {
          title: t, category_id: categoryId, priority, deadline, recurrence,
          notes: notes.trim() || null,
        })
        await reconcileSteps(todo.id)
      } else {
        const created = await todosService.createTodo({
          title: t, category_id: categoryId, priority, deadline, recurrence,
          notes: notes.trim() || null,
        })
        await reconcileSteps(created.id)
      }
      onSaved()
      onClose()
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save task')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!todo) return
    setSaving(true)
    try { await todosService.deleteTodo(todo.id); onSaved(); onClose() }
    catch (e) { Alert.alert('Delete failed', e instanceof Error ? e.message : 'Could not delete') }
    finally { setSaving(false) }
  }

  const dl = deadlineChips()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { backgroundColor: tc.surface2, borderColor: tc.border }]}>
          <View style={styles.handleRow}><View style={[styles.handle, { backgroundColor: tc.border3 }]} /></View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TextInput
              value={title} onChangeText={setTitle} placeholder="Task title" placeholderTextColor={tc.text4}
              style={[styles.titleInput, { color: tc.text1, borderBottomColor: tc.border }]} autoFocus={!todo}
            />

            <Text style={[styles.label, { color: tc.text3 }]}>PRIORITY</Text>
            <View style={styles.row}>
              {PRIORITIES.map((p) => (
                <Pressable key={p.value} onPress={() => setPriority(p.value)}
                  style={[styles.chip, { borderColor: priority === p.value ? p.color : tc.border, backgroundColor: priority === p.value ? tc.surface3 : 'transparent' }]}>
                  <View style={[styles.pdot, { backgroundColor: p.color }]} />
                  <Text style={[styles.chipTxt, { color: priority === p.value ? tc.text1 : tc.text3 }]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: tc.text3 }]}>CATEGORY</Text>
            <View style={styles.row}>
              {categories.map((c) => (
                <Pressable key={c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  style={[styles.chip, { borderColor: categoryId === c.id ? tc.border3 : tc.border, backgroundColor: categoryId === c.id ? tc.surface3 : 'transparent' }]}>
                  <View style={[styles.pdot, { backgroundColor: c.color }]} />
                  <Text style={[styles.chipTxt, { color: categoryId === c.id ? tc.text1 : tc.text3 }]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: tc.text3 }]}>REPEAT</Text>
            <View style={styles.row}>
              {RECURRENCES.map((r) => (
                <Pressable key={r.value} onPress={() => setRecurrence(r.value)}
                  style={[styles.chip, { borderColor: recurrence === r.value ? tc.border3 : tc.border, backgroundColor: recurrence === r.value ? tc.surface3 : 'transparent' }]}>
                  <Text style={[styles.chipTxt, { color: recurrence === r.value ? tc.text1 : tc.text3 }]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>

            {recurrence === 'none' && (
              <>
                <Text style={[styles.label, { color: tc.text3 }]}>DEADLINE</Text>
                <View style={styles.row}>
                  {dl.map((d) => (
                    <Pressable key={d.label} onPress={() => setDeadlineDate(d.date)}
                      style={[styles.chip, { borderColor: deadlineDate === d.date ? tc.border3 : tc.border, backgroundColor: deadlineDate === d.date ? tc.surface3 : 'transparent' }]}>
                      <Text style={[styles.chipTxt, { color: deadlineDate === d.date ? tc.text1 : tc.text3 }]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.label, { color: tc.text3 }]}>STEPS</Text>
            {steps.map((s, i) => (
              <View key={s.id ?? `new-${i}`} style={styles.stepRow}>
                <Pressable onPress={() => setSteps((prev) => prev.map((x, j) => j === i ? { ...x, done: !x.done } : x))} hitSlop={8}
                  style={[styles.check, { borderColor: tc.border3, backgroundColor: s.done ? tc.text2 : 'transparent' }]} />
                <Text style={[styles.stepTxt, { color: tc.text1, textDecorationLine: s.done ? 'line-through' : 'none', opacity: s.done ? 0.5 : 1 }]} numberOfLines={2}>{s.title}</Text>
                <Pressable onPress={() => setSteps((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                  <Text style={{ color: tc.text4, fontSize: 18 }}>×</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.stepRow}>
              <TextInput value={stepInput} onChangeText={setStepInput} placeholder="Add a step…" placeholderTextColor={tc.text4}
                style={[styles.stepInput, { color: tc.text1, borderColor: tc.border }]} onSubmitEditing={addStep} returnKeyType="done" />
              <Pressable onPress={addStep} hitSlop={8}><Text style={{ color: tc.text2, fontSize: 22 }}>+</Text></Pressable>
            </View>

            <Text style={[styles.label, { color: tc.text3 }]}>NOTES</Text>
            <TextInput value={notes} onChangeText={setNotes} placeholder="Optional notes…" placeholderTextColor={tc.text4}
              multiline style={[styles.notes, { color: tc.text1, borderColor: tc.border, backgroundColor: tc.surface1 }]} />

            <View style={styles.footer}>
              {todo && (
                <Pressable onPress={remove} disabled={saving} style={styles.deleteBtn}>
                  <Text style={[styles.deleteTxt, { color: '#C8102E' }]}>Delete</Text>
                </Pressable>
              )}
              <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { backgroundColor: tc.text1, opacity: saving ? 0.6 : 1 }]}>
                <Text style={[styles.saveTxt, { color: tc.bg }]}>{todo ? 'Save' : 'Add task'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '92%' },
  handleRow: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  titleInput: { fontSize: 20, fontFamily: fonts.displaySemiBold, fontWeight: '600', paddingVertical: 10, borderBottomWidth: 1, marginBottom: 6 },
  label: { fontSize: 10.5, letterSpacing: 1.8, fontFamily: fonts.ui, fontWeight: '600', marginTop: 14, marginBottom: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  pdot: { width: 7, height: 7, borderRadius: 3.5 },
  chipTxt: { fontSize: 13, fontFamily: fonts.ui, maxWidth: 130 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5 },
  stepTxt: { flex: 1, fontSize: 14.5, fontFamily: fonts.ui },
  stepInput: { flex: 1, fontSize: 14.5, fontFamily: fonts.ui, borderBottomWidth: 1, paddingVertical: 6 },
  notes: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14.5, fontFamily: fonts.ui, minHeight: 60, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginTop: 24 },
  deleteBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  deleteTxt: { fontSize: 15, fontFamily: fonts.ui, fontWeight: '600' },
  saveBtn: { paddingVertical: 13, paddingHorizontal: 28, borderRadius: 999 },
  saveTxt: { fontSize: 15, fontFamily: fonts.displaySemiBold, fontWeight: '700' },
})
