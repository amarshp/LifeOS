import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { DayTasksSwitch } from '../../src/components/DayTasksSwitch'
import { useSettings } from '../../src/contexts/SettingsContext'
import { fonts } from '../../src/theme/tokens'
import { todayStr } from '../../src/lib/date'
import { addLocalDays } from '../../src/lib/time-range'
import { emitTimerChange } from '../../src/lib/timer-events'
import { TodoBacklog, type TodoBacklogHandle } from '../../src/components/TodoBacklog'
import * as categoriesService from '../../src/services/categories'
import * as todosService from '../../src/services/todos'
import type { Category } from '../../src/types/database'

const ACCENT = '#C8102E'

function fmtDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function TasksScreen() {
  const { colors } = useSettings()
  const router = useRouter()
  const [date, setDate] = useState<string>(todayStr)
  const [categories, setCategories] = useState<Category[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const todoBacklogRef = useRef<TodoBacklogHandle>(null)

  useEffect(() => {
    categoriesService.getCategories().then(setCategories).catch(() => {})
  }, [])

  const addTask = useCallback(async () => {
    const title = taskInput.trim()
    if (!title || addingTask) return
    setAddingTask(true)
    try {
      await todosService.createTodo({ title })
      setTaskInput('')
      todoBacklogRef.current?.reload()
    } catch (e) {
      Alert.alert('Task', e instanceof Error ? e.message : 'Could not add task')
    } finally {
      setAddingTask(false)
    }
  }, [taskInput, addingTask])

  const shiftDate = useCallback((delta: number) => {
    setDate((d) => addLocalDays(d, delta))
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <DayTasksSwitch
          active="tasks"
          onSwitch={() => router.replace('/(tabs)/day')}
          colors={colors}
        />
      </View>

      <TodoBacklog
        ref={todoBacklogRef}
        colors={colors}
        categories={categories}
        planDate={date}
        onPlanChanged={emitTimerChange}
      />

      {/* Date selector: below the list — which day "+ plan" schedules into */}
      <View style={[styles.dateBar, { borderTopColor: colors.border }]}>
        <Pressable onPress={() => shiftDate(-1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>‹</Text>
        </Pressable>
        <Text style={[styles.dateLabel, { color: colors.text1 }]}>{fmtDate(date)}</Text>
        <Pressable onPress={() => shiftDate(1)} hitSlop={10} style={styles.dateArrow}>
          <Text style={[styles.arrow, { color: colors.text2 }]}>›</Text>
        </Pressable>
      </View>

      {/* Input bar: adds a task */}
      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface1, color: colors.text1, borderColor: colors.border }]}
          placeholder="Add a task…"
          placeholderTextColor={colors.text4}
          value={taskInput}
          onChangeText={setTaskInput}
          editable={!addingTask}
          onSubmitEditing={addTask}
          returnKeyType="done"
        />
        <Pressable
          onPress={addTask}
          disabled={addingTask || !taskInput.trim()}
          style={[styles.circleBtn, { backgroundColor: ACCENT, opacity: addingTask || !taskInput.trim() ? 0.4 : 1 }]}
        >
          {addingTask ? <ActivityIndicator color="#fff" /> : <Text style={styles.plusTxt}>+</Text>}
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  dateArrow: { paddingHorizontal: 8 },
  arrow: { fontSize: 26, fontWeight: '600' },
  dateLabel: { fontSize: 14, fontFamily: fonts.displaySemiBold, fontWeight: '600', letterSpacing: -0.2 },
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
  plusTxt: { color: '#fff', fontSize: 26, fontWeight: '300', lineHeight: 28 },
})
