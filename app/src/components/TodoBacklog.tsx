import { useCallback, useState } from 'react'
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'
import type { Category, Todo, TodoStep } from '../types/database'
import { todayStr } from '../lib/date'
import * as todosService from '../services/todos'
import { TodoEditorSheet } from './TodoEditorSheet'

interface TodoBacklogProps {
  colors: ColorPalette
  categories: Category[]
  planDate: string // the day "Add to plan" targets (Plan tab's selected date)
  onPlanChanged: () => void // a block was created → let Plan/Day refresh
}

const PRIORITY_COLOR = ['#7A766C', '#8BB4CC', '#CCAA6B', '#C8102E']

function dueLabel(dateStr: string | null): string {
  if (!dateStr) return ''
  const today = todayStr()
  if (dateStr === today) return 'today'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Group { key: string; title: string; items: Todo[] }

function groupTodos(todos: Todo[]): Group[] {
  const today = todayStr()
  const overdue: Todo[] = [], todayG: Todo[] = [], upcoming: Todo[] = [], noDate: Todo[] = []
  for (const t of todos) {
    const due = todosService.todoDueDate(t)
    if (!due) noDate.push(t)
    else if (due < today) overdue.push(t)
    else if (due === today) todayG.push(t)
    else upcoming.push(t)
  }
  return [
    { key: 'overdue', title: 'Overdue', items: overdue },
    { key: 'today', title: 'Today', items: todayG },
    { key: 'upcoming', title: 'Upcoming', items: upcoming },
    { key: 'nodate', title: 'No date', items: noDate },
  ].filter((g) => g.items.length > 0)
}

export function TodoBacklog({ colors: tc, categories, planDate, onPlanChanged }: TodoBacklogProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [stepsByTodo, setStepsByTodo] = useState<Record<string, TodoStep[]>>({})
  const [plannedIds, setPlannedIds] = useState<Set<string>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [quickTitle, setQuickTitle] = useState('')

  const load = useCallback(() => {
    todosService.getOpenTodos().then(async (ts) => {
      setTodos(ts)
      const steps = await todosService.getStepsForTodos(ts.map((t) => t.id)).catch(() => [])
      const map: Record<string, TodoStep[]> = {}
      for (const s of steps) (map[s.todo_id] ??= []).push(s)
      setStepsByTodo(map)
    }).catch(() => {})
    todosService.getPlannedTodoIdsForDate(planDate).then((ids) => setPlannedIds(new Set(ids))).catch(() => {})
  }, [planDate])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const complete = useCallback(async (todo: Todo) => {
    setTodos((prev) => prev.filter((t) => t.id !== todo.id)) // optimistic
    try { await todosService.completeTodo(todo) } catch { /* noop */ }
    load()
  }, [load])

  const addToPlan = useCallback(async (todo: Todo) => {
    try {
      await todosService.addTodoToPlan(todo, planDate)
      setPlannedIds((prev) => new Set(prev).add(todo.id))
      onPlanChanged()
    } catch (e) {
      Alert.alert('Plan', e instanceof Error ? e.message : 'Could not add to plan')
    }
  }, [planDate, onPlanChanged])

  // Quick add: a task is just a title — details (priority, repeat, category…)
  // live in the editor, opened by tapping the task.
  const quickAdd = useCallback(async () => {
    const title = quickTitle.trim()
    if (!title) return
    setQuickTitle('')
    try {
      await todosService.createTodo({ title })
      load()
    } catch (e) {
      Alert.alert('Task', e instanceof Error ? e.message : 'Could not add task')
    }
  }, [quickTitle, load])

  const openEdit = (t: Todo) => { setEditing(t); setEditorOpen(true) }

  const groups = groupTodos(todos)

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.quickRow, { borderColor: tc.border2, backgroundColor: tc.surface1 }]}>
          <TextInput
            value={quickTitle}
            onChangeText={setQuickTitle}
            placeholder="Add a task…"
            placeholderTextColor={tc.text4}
            style={[styles.quickInput, { color: tc.text1 }]}
            onSubmitEditing={quickAdd}
            returnKeyType="done"
            blurOnSubmit={false}
          />
          {quickTitle.trim().length > 0 && (
            <Pressable onPress={quickAdd} hitSlop={8} style={styles.quickBtn}>
              <Text style={{ color: tc.text1, fontSize: 22, lineHeight: 24 }}>＋</Text>
            </Pressable>
          )}
        </View>

        {todos.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: tc.text2 }]}>No tasks yet</Text>
            <Text style={[styles.emptyBody, { color: tc.text3 }]}>Just type what you want to get done — details are optional. Tap a task to edit; the planner pulls tasks into your day by priority.</Text>
          </View>
        )}

        {groups.map((g) => (
          <View key={g.key} style={styles.group}>
            <Text style={[styles.groupTitle, { color: g.key === 'overdue' ? '#C8102E' : tc.text3 }]}>{g.title.toUpperCase()}</Text>
            {g.items.map((t) => {
              const cat = categories.find((c) => c.id === t.category_id)
              const steps = stepsByTodo[t.id] ?? []
              const doneSteps = steps.filter((s) => s.done).length
              const due = todosService.todoDueDate(t)
              const planned = plannedIds.has(t.id)
              return (
                <Pressable key={t.id} onPress={() => openEdit(t)} style={[styles.card, { backgroundColor: tc.surface1, borderColor: tc.border }]}>
                  <Pressable onPress={() => complete(t)} hitSlop={10} style={[styles.check, { borderColor: tc.border3 }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.titleRow}>
                      <View style={[styles.pdot, { backgroundColor: PRIORITY_COLOR[t.priority] }]} />
                      <Text style={[styles.title, { color: tc.text1 }]} numberOfLines={1}>{t.title}</Text>
                      {t.recurrence !== 'none' && <Text style={[styles.recur, { color: tc.text4 }]}>↻</Text>}
                    </View>
                    {(cat || due || steps.length > 0) && (
                      <Text style={[styles.meta, { color: tc.text3 }]} numberOfLines={1}>
                        {[cat?.name, due ? dueLabel(due) : null, steps.length > 0 ? `${doneSteps}/${steps.length} steps` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                  </View>
                  {planned ? (
                    <Text style={[styles.planned, { color: cat?.color ?? tc.text3 }]}>✓ planned</Text>
                  ) : (
                    <Pressable onPress={() => addToPlan(t)} hitSlop={8} style={[styles.planBtn, { borderColor: tc.border3 }]}>
                      <Text style={[styles.planTxt, { color: tc.text2 }]}>+ plan</Text>
                    </Pressable>
                  )}
                </Pressable>
              )
            })}
          </View>
        ))}
      </ScrollView>

      <TodoEditorSheet
        visible={editorOpen}
        todo={editing}
        categories={categories}
        colors={tc}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  quickRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, marginBottom: 8 },
  quickInput: { flex: 1, fontSize: 15, fontFamily: fonts.ui, paddingVertical: 12 },
  quickBtn: { paddingLeft: 10, paddingVertical: 8 },
  empty: { paddingVertical: 40, paddingHorizontal: 8, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: fonts.displaySemiBold, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 21, textAlign: 'center' },
  group: { marginTop: 12, gap: 8 },
  groupTitle: { fontSize: 10.5, letterSpacing: 1.8, fontFamily: fonts.ui, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pdot: { width: 7, height: 7, borderRadius: 3.5 },
  title: { flex: 1, fontSize: 15.5, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2 },
  recur: { fontSize: 13, fontFamily: fonts.ui },
  meta: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 3 },
  planBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  planTxt: { fontSize: 12.5, fontFamily: fonts.ui, fontWeight: '500' },
  planned: { fontSize: 12.5, fontFamily: fonts.ui, fontWeight: '600' },
})
