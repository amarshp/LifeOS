import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useFocusEffect } from 'expo-router'
import { colors, spacing, fonts } from '../../src/theme/tokens'
import { useAuth } from '../../src/contexts/AuthContext'
import {
  useSettings,
  type QuickStartCount,
  type SnapDragTo,
  type WeekStart,
} from '../../src/contexts/SettingsContext'
import { supabase } from '../../src/lib/supabase'
import { reconcileNotifications } from '../../src/lib/notifications'
import * as categoriesService from '../../src/services/categories'
import * as tagsService from '../../src/services/tags'
import * as userSettingsService from '../../src/services/user-settings'
import type { NotificationPrefs } from '../../src/services/user-settings'
import type { CalendarBlock, Category, CategoryKind, CategoryUpdate, Tag, TimeEntry, WeeklyTemplateBlock } from '../../src/types/database'

const CATEGORY_PALETTE = [
  '#9B8EC0',  // muted indigo   (deep work, focus)
  '#8BB4CC',  // cornflower     (study, reading)
  '#CCAA6B',  // warm amber     (admin, tasks)
  '#8FBF8A',  // leaf green     (gym, physical)
  '#CCA8A8',  // dusty rose     (break, rest)
  '#8AAFAF',  // steel teal     (commute, transit)
  '#D4A5A5',  // blush          (social, warmth)
  '#A5BED4',  // sky            (planning, clarity)
  '#B5D4C2',  // mint           (wellness, calm)
  '#D4B5A5',  // peach          (creative, hobbies)
  '#94A3B8',  // slate          (utility, misc)
  '#64748B',  // dark slate     (night, sleep)
] as const

const QUICK_START_OPTIONS: QuickStartCount[] = [0, 2, 3, 4, 5]
const SNAP_OPTIONS: SnapDragTo[] = [5, 10, 15, 30]
const WEEK_START_OPTIONS: WeekStart[] = ['Monday', 'Sunday']
const SLEEP_START_OPTIONS = [19, 20, 21, 22, 23, 0, 1, 2]
const SLEEP_END_OPTIONS   = [4, 5, 6, 7, 8, 9, 10, 11]
const EXPECTED_SLEEP_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]

function formatHour(h: number): string {
  const h12 = h % 12 || 12
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h12} ${suffix}`
}

function formatSleepHours(h: number): string {
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`
}

type SheetName = 'categories' | 'tags' | 'quickStart' | 'weekStart' | 'snap' | 'export' | 'sleepStart' | 'sleepEnd' | 'expectedSleep' | null
type ExportFormat = 'json' | 'csv'

interface ExportSnapshot {
  exported_at: string
  account_email: string | null
  settings: {
    theme: string
    reduceMotion: boolean
    soundOnStop: boolean
    weekStartsOn: WeekStart
    snapDragTo: SnapDragTo
    quickStartCount: QuickStartCount
  }
  categories: Category[]
  tags: Tag[]
  weekly_template_blocks: WeeklyTemplateBlock[]
  calendar_blocks: CalendarBlock[]
  time_entries: TimeEntry[]
}

function showError(err: unknown, fallback: string) {
  const msg = err instanceof Error ? err.message : fallback
  Alert.alert('Error', msg)
}

// Notification lead-time presets — tapping a row cycles to the next one.
const PLAN_OFFSET_PRESETS: number[][] = [[5], [10], [15], [15, 5], [30, 10], [60, 15]]
const TASK_OFFSET_PRESETS: number[][] = [[15], [30], [60], [120], [1440]]
const RITUAL_PRESETS: (string | null)[] = [null, '20:30', '21:00', '21:30', '22:00']
const QUIET_PRESETS: Array<[number, number] | null> = [null, [22, 7], [23, 8], [0, 8]]

function fmtOffsets(mins: number[]): string {
  return mins.map(m => (m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`)).join(' + ') + ' before'
}

function fmtQuiet(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'Off'
  const f = (h: number) => `${String(h).padStart(2, '0')}:00`
  return `${f(start)} – ${f(end)}`
}

function nextPreset<T>(presets: T[], current: T): T {
  const idx = presets.findIndex(p => JSON.stringify(p) === JSON.stringify(current))
  return presets[(idx + 1) % presets.length]
}

function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { colors: tc } = useSettings()
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      style={[s.switch, { borderColor: tc.border2 }, on && [s.switchOn, { backgroundColor: tc.text1, borderColor: tc.text1 }]]}
    >
      <View style={[s.switchThumb, { backgroundColor: tc.text3 }, on && [s.switchThumbOn, { backgroundColor: tc.bg }]]} />
    </Pressable>
  )
}

function SettingsRow({
  label,
  sub,
  onPress,
  children,
  destructive = false,
}: {
  label: string
  sub?: string
  onPress?: () => void
  children?: ReactNode
  destructive?: boolean
}) {
  const { colors: tc } = useSettings()
  const content = (
    <>
      <Text style={[s.rowLabel, { color: destructive ? '#B47568' : tc.text1 }]}>{label}</Text>
      <View style={s.rowRight}>
        {children ?? (
          <>
            {sub && <Text style={[s.rowSub, { color: tc.text3 }]} numberOfLines={1}>{sub}</Text>}
            <Text style={[s.chevron, { color: destructive ? '#B47568' : tc.text4 }]}>›</Text>
          </>
        )}
      </View>
    </>
  )

  if (onPress) {
    return (
      <Pressable style={s.row} onPress={onPress}>
        {content}
      </Pressable>
    )
  }

  return <View style={s.row}>{content}</View>
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const { colors: tc } = useSettings()
  return (
    <View style={s.section}>
      <Text style={[s.eyebrow, { color: tc.text3 }]}>{title}</Text>
      {children}
    </View>
  )
}

function SheetFrame({
  visible,
  title,
  subtitle,
  onClose,
  closeLabel = 'Done',
  children,
}: {
  visible: boolean
  title: string
  subtitle?: string
  onClose: () => void
  closeLabel?: string
  children: ReactNode
}) {
  const { reduceMotion, colors: tc } = useSettings()
  const dragY = useRef(new Animated.Value(0)).current
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => { if (visible) dragY.setValue(0) }, [visible, dragY])

  // Drag the handle down to dismiss (settings auto-save, so closing = done).
  const pullGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY(10)
      .failOffsetX([-24, 24])
      .onUpdate(e => dragY.setValue(Math.max(0, e.translationY)))
      .onEnd(e => {
        if (e.translationY > 80) {
          Animated.timing(dragY, { toValue: 700, duration: 200, useNativeDriver: true }).start(() => onCloseRef.current())
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 320 }).start()
        }
      })
  , [dragY])

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.sheetBackdrop}>
          {/* Dismiss area behind the sheet — bounded so the card keeps its own height */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <Animated.View style={[s.sheet, { backgroundColor: tc.surface2, borderTopColor: tc.border }, { transform: [{ translateY: dragY }] }]}>
            <GestureDetector gesture={pullGesture}>
              <View style={s.handleArea}>
                <View style={[s.handle, { backgroundColor: tc.text5 }]} />
              </View>
            </GestureDetector>
            <View style={s.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.sheetSub, { color: tc.text3 }]}>Settings</Text>
                <Text style={[s.sheetTitle, { color: tc.text1 }]}>{title}</Text>
                {subtitle && <Text style={[s.sheetMeta, { color: tc.text3 }]}>{subtitle}</Text>}
              </View>
              <Pressable onPress={onClose} hitSlop={12} style={[s.closeBtn, { borderColor: tc.border2 }]}>
                <Text style={[s.closeBtnText, { color: tc.text2 }]}>{closeLabel}</Text>
              </Pressable>
            </View>
            <ScrollView
              style={s.sheetScroll}
              contentContainerStyle={s.sheetScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth()
  const settings = useSettings()
  const { colors: tc } = settings
  const [activeSheet, setActiveSheet] = useState<SheetName>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null)

  const loadData = useCallback(async () => {
    const [cats, allTags] = await Promise.all([
      categoriesService.getCategories(),
      tagsService.getAllTags(),
    ])
    setCategories(cats)
    setTags(allTags)
    userSettingsService.getUserSettings().then(setNotifPrefs).catch(() => {})
  }, [])

  // Save a notification pref, then rebuild the local schedule to match.
  const patchNotifPrefs = useCallback((patch: Partial<NotificationPrefs>) => {
    setNotifPrefs(prev => (prev ? { ...prev, ...patch } : prev))
    userSettingsService.updateNotificationPrefs(patch)
      .then(() => reconcileNotifications())
      .catch(err => showError(err, 'Could not save notification settings'))
  }, [])

  useFocusEffect(useCallback(() => {
    loadData().catch(() => {})
  }, [loadData]))

  const settingsForExport = useMemo(() => ({
    theme: settings.theme,
    reduceMotion: settings.reduceMotion,
    soundOnStop: settings.soundOnStop,
    weekStartsOn: settings.weekStartsOn,
    snapDragTo: settings.snapDragTo,
    quickStartCount: settings.quickStartCount,
  }), [
    settings.theme,
    settings.reduceMotion,
    settings.soundOnStop,
    settings.weekStartsOn,
    settings.snapDragTo,
    settings.quickStartCount,
  ])

  async function handleSignOut() {
    try {
      await signOut()
    } catch (err: unknown) {
      showError(err, 'Sign out failed')
    }
  }

  async function handleSyncPress() {
    try {
      await loadData()
      Alert.alert('Sync', `On · ${user?.email ?? 'signed in'}`)
    } catch (err: unknown) {
      showError(err, 'Sync check failed')
    }
  }

  async function buildExportSnapshot(): Promise<ExportSnapshot> {
    const [cats, allTags, templatesRes, blocksRes, entriesRes] = await Promise.all([
      categoriesService.getCategories(),
      tagsService.getAllTags(),
      supabase
        .from('weekly_template_blocks')
        .select('*')
        .is('deleted_at', null)
        .order('day_of_week')
        .order('start_time')
        .returns<WeeklyTemplateBlock[]>(),
      supabase
        .from('calendar_blocks')
        .select('*')
        .is('deleted_at', null)
        .order('date')
        .order('start_time')
        .returns<CalendarBlock[]>(),
      supabase
        .from('time_entries')
        .select('*')
        .is('deleted_at', null)
        .order('start_time')
        .returns<TimeEntry[]>(),
    ])

    const error = templatesRes.error ?? blocksRes.error ?? entriesRes.error
    if (error) throw error

    return {
      exported_at: new Date().toISOString(),
      account_email: user?.email ?? null,
      settings: settingsForExport,
      categories: cats,
      tags: allTags,
      weekly_template_blocks: templatesRes.data ?? [],
      calendar_blocks: blocksRes.data ?? [],
      time_entries: entriesRes.data ?? [],
    }
  }

  async function handleExport(format: ExportFormat) {
    try {
      const snapshot = await buildExportSnapshot()
      const message = format === 'json'
        ? JSON.stringify(snapshot, null, 2)
        : snapshotToCsv(snapshot)
      await Share.share({
        title: `LifeOS ${format.toUpperCase()} export`,
        message,
      })
    } catch (err: unknown) {
      showError(err, 'Export failed')
    }
  }

  return (
    <View style={[s.safe, { backgroundColor: tc.bg }]}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={[s.headerSub, { color: tc.text3 }]}>Preferences</Text>
          <Text style={[s.headerTitle, { color: tc.text1 }]}>Settings</Text>
        </View>

        <SettingsSection title="01 - Appearance">
          <SettingsRow label="Theme">
            <View style={[s.themeToggle, { borderColor: tc.border2 }]}>
              {(['Light', 'Dark', 'Auto'] as const).map(t => (
                <Pressable
                  key={t}
                  style={[s.themeBtn, settings.theme === t && [s.themeBtnActive, { backgroundColor: tc.text1 }]]}
                  onPress={() => settings.setTheme(t)}
                >
                  <Text style={[s.themeBtnText, { color: tc.text3 }, settings.theme === t && { color: tc.bg }]}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingsRow>
          <SettingsRow label="Reduce motion">
            <ToggleSwitch on={settings.reduceMotion} onToggle={() => settings.setReduceMotion(!settings.reduceMotion)} />
          </SettingsRow>
          <SettingsRow label="Sound on stop">
            <ToggleSwitch on={settings.soundOnStop} onToggle={() => settings.setSoundOnStop(!settings.soundOnStop)} />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="02 - Categories & tags">
          <SettingsRow label="Categories" sub={`${categories.length} · edit names & colors`} onPress={() => setActiveSheet('categories')} />
          <SettingsRow label="Tags" sub={`${tags.length} · review usage`} onPress={() => setActiveSheet('tags')} />
          <SettingsRow label="Quick start" sub={settings.quickStartCount === 0 ? 'Hidden' : `${settings.quickStartCount} recent`} onPress={() => setActiveSheet('quickStart')} />
        </SettingsSection>

        <SettingsSection title="03 - Day & week">
          <SettingsRow label="Week starts on" sub={settings.weekStartsOn} onPress={() => setActiveSheet('weekStart')} />
          <SettingsRow label="Snap drag to" sub={`${settings.snapDragTo} min`} onPress={() => setActiveSheet('snap')} />
          <SettingsRow label="Expected sleep" sub={formatSleepHours(settings.expectedSleepHours)} onPress={() => setActiveSheet('expectedSleep')} />
          <SettingsRow label="Hide sleep">
            <ToggleSwitch on={settings.hideSleep} onToggle={() => settings.setHideSleep(!settings.hideSleep)} />
          </SettingsRow>
          {settings.hideSleep && (
            <>
              <SettingsRow label="Bedtime" sub={formatHour(settings.sleepStart)} onPress={() => setActiveSheet('sleepStart')} />
              <SettingsRow label="Wake time" sub={formatHour(settings.sleepEnd)} onPress={() => setActiveSheet('sleepEnd')} />
            </>
          )}
        </SettingsSection>

        {notifPrefs && (
          <SettingsSection title="04 - Notifications">
            <SettingsRow label="Plan reminders">
              <ToggleSwitch on={notifPrefs.notif_plan_enabled} onToggle={() => patchNotifPrefs({ notif_plan_enabled: !notifPrefs.notif_plan_enabled })} />
            </SettingsRow>
            {notifPrefs.notif_plan_enabled && (
              <SettingsRow
                label="Plan lead time"
                sub={fmtOffsets(notifPrefs.notif_plan_offsets_min)}
                onPress={() => patchNotifPrefs({ notif_plan_offsets_min: nextPreset(PLAN_OFFSET_PRESETS, notifPrefs.notif_plan_offsets_min) })}
              />
            )}
            <SettingsRow label="Task reminders">
              <ToggleSwitch on={notifPrefs.notif_task_enabled} onToggle={() => patchNotifPrefs({ notif_task_enabled: !notifPrefs.notif_task_enabled })} />
            </SettingsRow>
            {notifPrefs.notif_task_enabled && (
              <SettingsRow
                label="Task lead time"
                sub={fmtOffsets(notifPrefs.notif_task_offsets_min)}
                onPress={() => patchNotifPrefs({ notif_task_offsets_min: nextPreset(TASK_OFFSET_PRESETS, notifPrefs.notif_task_offsets_min) })}
              />
            )}
            <SettingsRow
              label="Plan-tomorrow nudge"
              sub={notifPrefs.notif_plan_tomorrow_hhmm ?? 'Off'}
              onPress={() => patchNotifPrefs({ notif_plan_tomorrow_hhmm: nextPreset(RITUAL_PRESETS, notifPrefs.notif_plan_tomorrow_hhmm) })}
            />
            <SettingsRow
              label="Quiet hours"
              sub={fmtQuiet(notifPrefs.quiet_hours_start, notifPrefs.quiet_hours_end)}
              onPress={() => {
                const current: [number, number] | null =
                  notifPrefs.quiet_hours_start !== null && notifPrefs.quiet_hours_end !== null
                    ? [notifPrefs.quiet_hours_start, notifPrefs.quiet_hours_end]
                    : null
                const next = nextPreset(QUIET_PRESETS, current)
                patchNotifPrefs({ quiet_hours_start: next?.[0] ?? null, quiet_hours_end: next?.[1] ?? null })
              }}
            />
          </SettingsSection>
        )}

        <SettingsSection title="05 - Advanced">
          <SettingsRow label="Simultaneous timers">
            <ToggleSwitch on={settings.allowParallelTimers} onToggle={() => settings.setAllowParallelTimers(!settings.allowParallelTimers)} />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="06 - Account">
          <SettingsRow label="Sync" sub={`On · ${user?.email ?? '—'}`} onPress={handleSyncPress} />
          <SettingsRow label="Export data" sub="CSV · JSON" onPress={() => setActiveSheet('export')} />
          <SettingsRow label="Sign out" destructive onPress={handleSignOut} />
        </SettingsSection>
      </ScrollView>

      <CategoryManagerSheet
        visible={activeSheet === 'categories'}
        categories={categories}
        tags={tags}
        onChanged={loadData}
        onClose={() => setActiveSheet(null)}
      />
      <TagManagerSheet
        visible={activeSheet === 'tags'}
        categories={categories}
        tags={tags}
        onChanged={loadData}
        onClose={() => setActiveSheet(null)}
      />
      <QuickStartSheet
        visible={activeSheet === 'quickStart'}
        value={settings.quickStartCount}
        onSelect={settings.setQuickStartCount}
        onClose={() => setActiveSheet(null)}
      />
      <WeekStartSheet
        visible={activeSheet === 'weekStart'}
        value={settings.weekStartsOn}
        onSelect={settings.setWeekStartsOn}
        onClose={() => setActiveSheet(null)}
      />
      <SnapSheet
        visible={activeSheet === 'snap'}
        value={settings.snapDragTo}
        onSelect={settings.setSnapDragTo}
        onClose={() => setActiveSheet(null)}
      />
      <ExportSheet
        visible={activeSheet === 'export'}
        onExport={handleExport}
        onClose={() => setActiveSheet(null)}
      />
      <ChoiceSheet
        visible={activeSheet === 'sleepStart'}
        title="Bedtime"
        subtitle="Day view"
        options={SLEEP_START_OPTIONS}
        value={settings.sleepStart}
        getLabel={formatHour}
        getSub={() => ''}
        onSelect={settings.setSleepStart}
        onClose={() => setActiveSheet(null)}
      />
      <ChoiceSheet
        visible={activeSheet === 'sleepEnd'}
        title="Wake time"
        subtitle="Day view"
        options={SLEEP_END_OPTIONS}
        value={settings.sleepEnd}
        getLabel={formatHour}
        getSub={() => ''}
        onSelect={settings.setSleepEnd}
        onClose={() => setActiveSheet(null)}
      />
      <ChoiceSheet
        visible={activeSheet === 'expectedSleep'}
        title="Expected sleep"
        subtitle="Nightly target — used by the AI planner and Insights"
        options={EXPECTED_SLEEP_OPTIONS}
        value={settings.expectedSleepHours}
        getLabel={formatSleepHours}
        getSub={() => ''}
        onSelect={settings.setExpectedSleepHours}
        onClose={() => setActiveSheet(null)}
      />
    </View>
  )
}

function CategoryManagerSheet({
  visible,
  categories,
  tags,
  onChanged,
  onClose,
}: {
  visible: boolean
  categories: Category[]
  tags: Tag[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const { colors: tc } = useSettings()
  const [expandedId, setExpandedId] = useState<string | 'new' | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string>(CATEGORY_PALETTE[0])
  const [editKind, setEditKind] = useState<CategoryKind>('discretionary')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) setExpandedId(null)
  }, [visible])

  // Populate form fields only when the expanded row changes, not on every
  // categories refresh (which would overwrite in-progress edits).
  const prevExpandedId = useRef<string | 'new' | null>(null)
  useEffect(() => {
    if (expandedId === prevExpandedId.current) return
    prevExpandedId.current = expandedId
    if (expandedId === null) return
    if (expandedId === 'new') {
      setEditName('')
      setEditColor(CATEGORY_PALETTE[0])
      setEditKind('discretionary')
    } else {
      const cat = categories.find(c => c.id === expandedId)
      if (cat) { setEditName(cat.name); setEditColor(cat.color); setEditKind(cat.kind ?? 'discretionary') }
    }
  }, [expandedId, categories])

  async function handleSave() {
    const trimmedName = editName.trim()
    if (!trimmedName) { Alert.alert('Required', 'Enter a category name'); return }
    setSaving(true)
    try {
      if (expandedId === 'new') {
        const sortOrder = categories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1
        await categoriesService.createCategory({ name: trimmedName, color: editColor, sort_order: sortOrder, kind: editKind })
      } else if (expandedId) {
        await categoriesService.updateCategory(expandedId, { name: trimmedName, color: editColor, kind: editKind })
      }
      await onChanged()
      setExpandedId(null)
    } catch (err: unknown) {
      showError(err, 'Could not save category')
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(categoryId: string) {
    const cat = categories.find(c => c.id === categoryId)
    const tagIds = tags.filter(t => t.category_id === categoryId).map(t => t.id)
    const detail = tagIds.length > 0
      ? `Also removes ${tagIds.length} tag${tagIds.length > 1 ? 's' : ''}.`
      : 'This cannot be undone.'
    Alert.alert(`Delete "${cat?.name ?? 'category'}"?`, detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setSaving(true)
          try {
            await Promise.all(tagIds.map(id => tagsService.deleteTag(id)))
            await categoriesService.deleteCategory(categoryId)
            await onChanged()
            if (expandedId === categoryId) setExpandedId(null)
          } catch (err: unknown) {
            showError(err, 'Could not delete category')
          } finally {
            setSaving(false)
          }
        },
      },
    ])
  }

  // Existing categories auto-save: name on blur, colour & kind on tap.
  async function patchCurrent(updates: CategoryUpdate) {
    if (!expandedId || expandedId === 'new') return
    try {
      await categoriesService.updateCategory(expandedId, updates)
      await onChanged()
    } catch (err: unknown) {
      showError(err, 'Could not save category')
    }
  }

  function commitName() {
    const trimmed = editName.trim()
    if (!trimmed || !expandedId || expandedId === 'new') return
    if (categories.find(c => c.id === expandedId)?.name === trimmed) return
    void patchCurrent({ name: trimmed })
  }

  function renderForm(isNew: boolean) {
    return (
      <View style={[s.inlineForm, { borderTopColor: tc.border }]}>
        {isNew && (
          <TextInput
            style={[s.input, { color: tc.text1, borderBottomColor: tc.border2 }]}
            value={editName}
            onChangeText={setEditName}
            placeholder="Category name"
            placeholderTextColor={tc.text4}
            autoFocus
          />
        )}
        <View style={[s.swatchGrid, { marginTop: isNew ? 14 : 2 }]}>
          {CATEGORY_PALETTE.map(color => (
            <Pressable
              key={color}
              onPress={() => { setEditColor(color); if (!isNew) void patchCurrent({ color }) }}
              style={[s.colorSwatch, { backgroundColor: color }, editColor === color && [s.colorSwatchSelected, { borderColor: tc.text1 }]]}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {(['discretionary', 'essential'] as const).map(k => (
            <Pressable
              key={k}
              onPress={() => { setEditKind(k); if (!isNew) void patchCurrent({ kind: k }) }}
              style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center', borderColor: editKind === k ? tc.text1 : tc.border2, backgroundColor: editKind === k ? tc.text1 : 'transparent' }}
            >
              <Text style={{ fontSize: 13, fontFamily: fonts.ui, fontWeight: '600', color: editKind === k ? tc.bg : tc.text2 }}>
                {k === 'essential' ? 'Essential' : 'Discretionary'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 11.5, fontFamily: fonts.ui, color: tc.text4, marginTop: 6 }}>
          Essential = have-to time (sleep, food, commute). Keeps Insights rankings focused on discretionary time.
        </Text>
        {isNew ? (
          <Pressable
            style={[s.primaryBtn, { backgroundColor: tc.text1, opacity: saving ? 0.5 : 1, marginTop: 16 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[s.primaryText, { color: tc.bg }]}>{saving ? 'Saving…' : 'Create'}</Text>
          </Pressable>
        ) : (
          <View style={s.formFooterRow}>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.ui, color: tc.text4, flex: 1 }}>Changes save automatically</Text>
            {expandedId && expandedId !== 'new' && (
              <Pressable onPress={() => confirmDelete(expandedId)} hitSlop={8}>
                <Text style={s.deleteText}>Delete</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    )
  }

  return (
    <SheetFrame visible={visible} title="Categories" subtitle={`${categories.length} total`} onClose={onClose}>
      <View style={s.managerList}>
        {categories.map(category => {
          const isExpanded = expandedId === category.id
          return (
            <View key={category.id}>
              <View style={[s.managerRow, { backgroundColor: isExpanded ? tc.surface3 : tc.surface1 }]}>
                <View style={[s.colorDot, { backgroundColor: isExpanded ? editColor : category.color }]} />
                {isExpanded ? (
                  <TextInput
                    style={[s.managerTitle, s.inlineNameInput, { color: tc.text1, borderBottomColor: tc.border2 }]}
                    value={editName}
                    onChangeText={setEditName}
                    onEndEditing={commitName}
                    onBlur={commitName}
                    placeholder="Category name"
                    placeholderTextColor={tc.text4}
                    autoFocus
                  />
                ) : (
                  <Pressable style={s.rowNameTap} onPress={() => setExpandedId(category.id)} onLongPress={() => confirmDelete(category.id)} delayLongPress={500}>
                    <Text style={[s.managerTitle, { color: tc.text1 }]} numberOfLines={1}>{category.name}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setExpandedId(isExpanded ? null : category.id)} hitSlop={12}>
                  <Text style={[s.expandChevron, { color: tc.text4 }]}>{isExpanded ? '▴' : '▾'}</Text>
                </Pressable>
              </View>
              {isExpanded && renderForm(false)}
            </View>
          )
        })}

        {expandedId === 'new'
          ? renderForm(true)
          : (
            <Pressable
              style={[s.managerRow, { backgroundColor: tc.surface1, justifyContent: 'center' }]}
              onPress={() => setExpandedId('new')}
            >
              <Text style={[s.addCatLabel, { color: tc.text3 }]}>+ Add category</Text>
            </Pressable>
          )
        }
      </View>
    </SheetFrame>
  )
}

function TagManagerSheet({
  visible,
  categories,
  tags,
  onChanged,
  onClose,
}: {
  visible: boolean
  categories: Category[]
  tags: Tag[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const { colors: tc } = useSettings()
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | 'new' | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) { setExpandedId(null); return }
    if (!selectedCategoryId && categories.length > 0) setSelectedCategoryId(categories[0].id)
    if (selectedCategoryId && !categories.some(c => c.id === selectedCategoryId)) {
      setSelectedCategoryId(categories[0]?.id ?? null)
    }
  }, [visible, categories, selectedCategoryId])

  const prevExpandedId = useRef<string | 'new' | null>(null)
  useEffect(() => {
    if (expandedId === prevExpandedId.current) return
    prevExpandedId.current = expandedId
    if (expandedId === null) return
    if (expandedId === 'new') {
      setEditName('')
    } else {
      const tag = tags.find(t => t.id === expandedId)
      if (tag) setEditName(tag.name)
    }
  }, [expandedId, tags])

  const selectedCategory = categories.find(c => c.id === selectedCategoryId)
  const visibleTags = tags.filter(t => t.category_id === selectedCategoryId)

  async function handleSave() {
    const trimmedName = editName.trim()
    if (!selectedCategoryId) { Alert.alert('Required', 'Create a category first'); return }
    if (!trimmedName) { Alert.alert('Required', 'Enter a tag name'); return }
    setSaving(true)
    try {
      if (expandedId === 'new') {
        await tagsService.createTag({ category_id: selectedCategoryId, name: trimmedName })
      } else if (expandedId) {
        await tagsService.updateTag(expandedId, { name: trimmedName })
      }
      await onChanged()
      setExpandedId(null)
    } catch (err: unknown) {
      showError(err, 'Could not save tag')
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(tagId: string) {
    const tag = tags.find(t => t.id === tagId)
    Alert.alert(`Delete "${tag?.name ?? 'tag'}"?`, 'This removes the tag from future pickers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setSaving(true)
          try {
            await tagsService.deleteTag(tagId)
            await onChanged()
            if (expandedId === tagId) setExpandedId(null)
          } catch (err: unknown) {
            showError(err, 'Could not delete tag')
          } finally {
            setSaving(false)
          }
        },
      },
    ])
  }

  function commitTagName() {
    const trimmed = editName.trim()
    if (!trimmed || !expandedId || expandedId === 'new') return
    if (tags.find(t => t.id === expandedId)?.name === trimmed) return
    void (async () => {
      try {
        await tagsService.updateTag(expandedId, { name: trimmed })
        await onChanged()
      } catch (err: unknown) { showError(err, 'Could not save tag') }
    })()
  }

  function renderTagForm(isNew: boolean) {
    return (
      <View style={[s.inlineForm, { borderTopColor: tc.border }]}>
        {isNew ? (
          <>
            <TextInput
              style={[s.input, { color: tc.text1, borderBottomColor: tc.border2 }]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Tag name"
              placeholderTextColor={tc.text4}
              autoFocus
            />
            <Pressable
              style={[s.primaryBtn, { backgroundColor: tc.text1, opacity: saving ? 0.5 : 1, marginTop: 16 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={[s.primaryText, { color: tc.bg }]}>{saving ? 'Saving…' : 'Create'}</Text>
            </Pressable>
          </>
        ) : (
          <View style={s.formFooterRow}>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.ui, color: tc.text4, flex: 1 }}>Changes save automatically</Text>
            {expandedId && expandedId !== 'new' && (
              <Pressable onPress={() => confirmDelete(expandedId)} hitSlop={8}>
                <Text style={s.deleteText}>Delete</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    )
  }

  return (
    <SheetFrame visible={visible} title="Tags" subtitle={`${tags.length} total`} onClose={onClose}>
      <View style={s.categoryStrip}>
        {categories.map(category => (
          <Pressable
            key={category.id}
            style={[s.categoryPill, { borderColor: tc.border2 }, selectedCategoryId === category.id && { backgroundColor: tc.text1, borderColor: tc.text1 }]}
            onPress={() => {
              setSelectedCategoryId(category.id)
              setExpandedId(null)
            }}
          >
            <View style={[s.pillDot, { backgroundColor: category.color }]} />
            <Text style={[s.categoryPillText, { color: selectedCategoryId === category.id ? tc.bg : tc.text2 }]}>{category.name}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.managerList}>
        {visibleTags.map(tag => {
          const isExpanded = expandedId === tag.id
          return (
            <View key={tag.id}>
              <View style={[s.managerRow, { backgroundColor: isExpanded ? tc.surface3 : tc.surface1 }]}>
                <View style={[s.colorDot, { backgroundColor: selectedCategory?.color ?? tc.text3 }]} />
                {isExpanded ? (
                  <TextInput
                    style={[s.managerTitle, s.inlineNameInput, { color: tc.text1, borderBottomColor: tc.border2 }]}
                    value={editName}
                    onChangeText={setEditName}
                    onEndEditing={commitTagName}
                    onBlur={commitTagName}
                    placeholder="Tag name"
                    placeholderTextColor={tc.text4}
                    autoFocus
                  />
                ) : (
                  <Pressable style={s.rowNameTap} onPress={() => setExpandedId(tag.id)} onLongPress={() => confirmDelete(tag.id)} delayLongPress={500}>
                    <Text style={[s.managerTitle, { color: tc.text1 }]} numberOfLines={1}>{tag.name}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setExpandedId(isExpanded ? null : tag.id)} hitSlop={12}>
                  <Text style={[s.expandChevron, { color: tc.text4 }]}>{isExpanded ? '▴' : '▾'}</Text>
                </Pressable>
              </View>
              {isExpanded && renderTagForm(false)}
            </View>
          )
        })}

        {visibleTags.length === 0 && expandedId !== 'new' && (
          <Text style={[s.emptyText, { color: tc.text3 }]}>No tags for this category</Text>
        )}

        {expandedId === 'new'
          ? renderTagForm(true)
          : (
            <Pressable
              style={[s.managerRow, { backgroundColor: tc.surface1, justifyContent: 'center' }]}
              onPress={() => setExpandedId('new')}
            >
              <Text style={[s.addCatLabel, { color: tc.text3 }]}>+ Add tag</Text>
            </Pressable>
          )
        }
      </View>
    </SheetFrame>
  )
}

function QuickStartSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean
  value: QuickStartCount
  onSelect: (value: QuickStartCount) => void
  onClose: () => void
}) {
  return (
    <ChoiceSheet
      visible={visible}
      title="Quick start"
      subtitle="Home"
      options={QUICK_START_OPTIONS}
      value={value}
      getLabel={(count) => count === 0 ? 'Hidden' : `${count} recent`}
      getSub={(count) => count === 0 ? 'Hide recent timer chips' : `Show ${count} quick-start chips`}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}

function WeekStartSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean
  value: WeekStart
  onSelect: (value: WeekStart) => void
  onClose: () => void
}) {
  return (
    <ChoiceSheet
      visible={visible}
      title="Week starts on"
      subtitle="Week view"
      options={WEEK_START_OPTIONS}
      value={value}
      getLabel={(option) => option}
      getSub={(option) => option === 'Monday' ? 'ISO work week' : 'Calendar week'}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}

function SnapSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean
  value: SnapDragTo
  onSelect: (value: SnapDragTo) => void
  onClose: () => void
}) {
  return (
    <ChoiceSheet
      visible={visible}
      title="Snap drag to"
      subtitle="Day view"
      options={SNAP_OPTIONS}
      value={value}
      getLabel={(option) => `${option} min`}
      getSub={(option) => option === 5 ? 'Finest movement' : `${60 / option} steps per hour`}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}

function ChoiceSheet<T extends string | number>({
  visible,
  title,
  subtitle,
  options,
  value,
  getLabel,
  getSub,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  subtitle?: string
  options: T[]
  value: T
  getLabel: (option: T) => string
  getSub: (option: T) => string
  onSelect: (option: T) => void
  onClose: () => void
}) {
  const { colors: tc } = useSettings()
  return (
    <SheetFrame visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      <View style={s.choiceList}>
        {options.map(option => {
          const active = option === value
          return (
            <Pressable
              key={String(option)}
              style={[s.choiceRow, { backgroundColor: active ? tc.text1 : tc.surface1 }]}
              onPress={() => {
                onSelect(option)
                onClose()
              }}
            >
              <View>
                <Text style={[s.choiceTitle, { color: active ? tc.bg : tc.text1 }]}>{getLabel(option)}</Text>
                <Text style={[s.choiceSub, { color: active ? tc.bg + '99' : tc.text3 }]}>{getSub(option)}</Text>
              </View>
              {active && <Text style={[s.choiceCheck, { color: tc.bg }]}>✓</Text>}
            </Pressable>
          )
        })}
      </View>
    </SheetFrame>
  )
}

function ExportSheet({
  visible,
  onExport,
  onClose,
}: {
  visible: boolean
  onExport: (format: ExportFormat) => Promise<void>
  onClose: () => void
}) {
  const { colors: tc } = useSettings()
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  async function run(format: ExportFormat) {
    setBusy(format)
    try {
      await onExport(format)
    } finally {
      setBusy(null)
    }
  }

  return (
    <SheetFrame visible={visible} title="Export data" subtitle="CSV · JSON" onClose={onClose}>
      <View style={s.choiceList}>
        <Pressable style={[s.choiceRow, { backgroundColor: tc.surface1, opacity: busy ? 0.5 : 1 }]} onPress={() => run('json')} disabled={busy !== null}>
          <View>
            <Text style={[s.choiceTitle, { color: tc.text1 }]}>JSON</Text>
            <Text style={[s.choiceSub, { color: tc.text3 }]}>{busy === 'json' ? 'Preparing' : 'Full backup'}</Text>
          </View>
        </Pressable>
        <Pressable style={[s.choiceRow, { backgroundColor: tc.surface1, opacity: busy ? 0.5 : 1 }]} onPress={() => run('csv')} disabled={busy !== null}>
          <View>
            <Text style={[s.choiceTitle, { color: tc.text1 }]}>CSV</Text>
            <Text style={[s.choiceSub, { color: tc.text3 }]}>{busy === 'csv' ? 'Preparing' : 'Tables'}</Text>
          </View>
        </Pressable>
      </View>
    </SheetFrame>
  )
}

function snapshotToCsv(snapshot: ExportSnapshot): string {
  const metadata = [{
    exported_at: snapshot.exported_at,
    account_email: snapshot.account_email,
    ...snapshot.settings,
  }]

  return [
    tableToCsv('metadata', metadata),
    tableToCsv('categories', snapshot.categories),
    tableToCsv('tags', snapshot.tags),
    tableToCsv('weekly_template_blocks', snapshot.weekly_template_blocks),
    tableToCsv('calendar_blocks', snapshot.calendar_blocks),
    tableToCsv('time_entries', snapshot.time_entries),
  ].filter(Boolean).join('\n\n')
}

function tableToCsv(tableName: string, rows: object[]): string {
  if (rows.length === 0) return ''
  const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
  const header = ['table', ...keys].map(csvCell).join(',')
  const body = rows.map(row => {
    const record = row as Record<string, unknown>
    return [tableName, ...keys.map(key => record[key])].map(csvCell).join(',')
  })
  return [header, ...body].join('\n')
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 18,
    paddingBottom: 10,
  },
  headerSub: {
    color: colors.text3,
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    fontFamily: fonts.displayItalic,
    letterSpacing: 0.7,
  },
  headerTitle: {
    color: colors.text1,
    fontSize: 40,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    letterSpacing: -1,
    marginTop: 6,
  },
  section: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 20,
  },
  eyebrow: {
    color: colors.text3,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 2.3,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
    marginBottom: 6,
  },
  row: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  rowLabel: {
    color: colors.text1,
    fontSize: 16,
    fontWeight: '500',
    fontFamily: fonts.displayMedium,
    flexShrink: 0,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginLeft: 16,
    flexShrink: 1,
  },
  rowSub: {
    color: colors.text3,
    fontSize: 11.5,
    letterSpacing: 0.2,
    fontFamily: fonts.ui,
    maxWidth: 150,
  },
  chevron: {
    color: colors.text4,
    fontSize: 18,
    fontFamily: fonts.display,
    lineHeight: 18,
  },

  themeToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: 999,
    padding: 2,
  },
  themeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    minWidth: 54,
    alignItems: 'center',
  },
  themeBtnActive: {
    backgroundColor: colors.text1,
  },
  themeBtnText: {
    color: colors.text3,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },

  switch: {
    width: 36,
    height: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    paddingHorizontal: 1,
  },
  switchOn: {
    backgroundColor: colors.text1,
    borderColor: colors.text1,
  },
  switchThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.text3,
  },
  switchThumbOn: {
    backgroundColor: colors.bg,
    alignSelf: 'flex-end',
  },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 26,
    paddingTop: 8,
    maxHeight: '88%',
  },
  handle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.text5,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  sheetSub: {
    color: colors.text3,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 2.3,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  sheetTitle: {
    color: colors.text1,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    letterSpacing: -0.36,
    marginTop: 3,
  },
  sheetMeta: {
    color: colors.text3,
    fontSize: 11.5,
    marginTop: 4,
    fontFamily: fonts.ui,
  },
  closeText: {
    color: colors.text3,
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: fonts.ui,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetScrollContent: { paddingBottom: 8 },

  managerList: {
    gap: 8,
    marginBottom: 20,
  },
  managerRow: {
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  managerTitle: {
    flex: 1,
    color: colors.text1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fonts.displaySemiBold,
  },
  emptyText: {
    color: colors.text3,
    fontSize: 13,
    fontFamily: fonts.ui,
    paddingVertical: 12,
  },
  input: {
    color: colors.text1,
    fontSize: 22,
    fontWeight: '400',
    fontFamily: fonts.display,
    letterSpacing: -0.33,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
    paddingVertical: 12,
    paddingTop: 14,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderWidth: 3,
  },
  categoryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  pillDot: { width: 7, height: 7, borderRadius: 3.5 },
  categoryPillText: {
    color: colors.text2,
    fontSize: 12,
    fontFamily: fonts.ui,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.text1,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: '400',
    letterSpacing: 0.44,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },

  choiceList: {
    gap: 8,
  },
  choiceRow: {
    minHeight: 58,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  choiceTitle: {
    color: colors.text1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fonts.displaySemiBold,
  },
  choiceSub: {
    color: colors.text3,
    fontSize: 11.5,
    marginTop: 2,
    fontFamily: fonts.ui,
  },
  choiceCheck: {
    color: colors.bg,
    fontSize: 18,
    fontFamily: fonts.ui,
  },
  inlineForm: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  expandChevron: {
    fontSize: 10,
    fontFamily: fonts.ui,
    marginLeft: 4,
  },
  addCatLabel: {
    fontSize: 13,
    fontFamily: fonts.ui,
    letterSpacing: 0.3,
  },
  handleArea: {
    paddingBottom: 10,
    alignItems: 'center',
  },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  closeBtnText: {
    fontSize: 14,
    fontFamily: fonts.ui,
    fontWeight: '600',
  },
  rowNameTap: { flex: 1 },
  inlineNameInput: {
    paddingVertical: 3,
    borderBottomWidth: 1,
  },
  formFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 12,
  },
  deleteText: {
    fontSize: 13,
    fontFamily: fonts.ui,
    fontWeight: '600',
    color: '#B86B6B',
  },
})
