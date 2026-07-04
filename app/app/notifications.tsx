import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../src/contexts/SettingsContext'
import { fonts } from '../src/theme/tokens'
import { computeUpcoming, reconcileNotifications, type UpcomingNotification } from '../src/lib/notifications'
import * as remindersService from '../src/services/reminders'

// Notification Center — the queue of everything that is going to ring:
// plan-block reminders, task deadlines, rituals, and agent/user reminders.
// Direct reminders can be cancelled here; derived rows follow their source.

const KIND_LABEL: Record<UpcomingNotification['kind'], string> = {
  plan: 'plan',
  task: 'task',
  ritual: 'ritual',
  reminder: 'reminder',
}

function fmtFire(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  const tomorrow = new Date(today.getTime() + 86_400_000)
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}

export default function NotificationsScreen() {
  const router = useRouter()
  const { colors: tc } = useSettings()
  const [items, setItems] = useState<UpcomingNotification[]>([])

  const load = useCallback(() => {
    computeUpcoming().then(setItems).catch(() => {})
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const cancel = useCallback(async (item: UpcomingNotification) => {
    if (!item.reminderId) return
    setItems(prev => prev.filter(i => i.id !== item.id)) // optimistic
    try {
      await remindersService.cancelReminder(item.reminderId)
      await reconcileNotifications()
    } catch {
      load()
    }
  }, [load])

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: tc.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={[styles.backText, { color: tc.text2 }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: tc.text1 }]}>Upcoming</Text>
        <Text style={[styles.count, { color: tc.text3 }]}>{items.length || ''}</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: tc.text3 }]}>Nothing scheduled</Text>
          <Text style={[styles.emptyHint, { color: tc.text4 }]}>
            Plan blocks, task deadlines, and agent reminders queue up here
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {items.map(item => (
            <View key={item.id} style={[styles.row, { borderBottomColor: tc.border }]}>
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, { color: tc.text1 }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.rowSub, { color: tc.text3 }]} numberOfLines={1}>
                  {KIND_LABEL[item.kind]}{item.body ? ` · ${item.body}` : ''}
                </Text>
              </View>
              <Text style={[styles.rowTime, { color: tc.text2 }]}>{fmtFire(item.fireMs)}</Text>
              {item.reminderId && (
                <Pressable onPress={() => cancel(item)} hitSlop={10} style={[styles.cancelBtn, { borderColor: tc.border3 }]}>
                  <Text style={[styles.cancelText, { color: tc.text3 }]}>✕</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
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
    paddingBottom: 14,
  },
  back: { paddingRight: 2 },
  backText: { fontSize: 14, fontFamily: fonts.ui },
  title: { fontSize: 24, fontWeight: '700', fontFamily: fonts.displayBold, letterSpacing: -0.4, flex: 1 },
  count: { fontSize: 14, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] },

  empty: { flex: 1, alignItems: 'center', paddingTop: 90, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, fontFamily: fonts.displaySemiBold },
  emptyHint: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  scroll: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 60 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', fontFamily: fonts.displaySemiBold, letterSpacing: -0.2 },
  rowSub: { fontSize: 12, fontFamily: fonts.ui },
  rowTime: { fontSize: 13, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] },
  cancelBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 11 },
})
