import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { Appearance } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { darkColors, lightColors } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'

export type ThemeMode = 'Light' | 'Dark' | 'Auto'
export type WeekStart = 'Monday' | 'Sunday'
export type SnapDragTo = 5 | 10 | 15 | 30
export type QuickStartCount = 0 | 2 | 3 | 4 | 5

export interface Settings {
  theme: ThemeMode
  reduceMotion: boolean
  soundOnStop: boolean
  weekStartsOn: WeekStart
  snapDragTo: SnapDragTo
  quickStartCount: QuickStartCount
  showWeekTab: boolean
  hideSleep: boolean
  sleepStart: number  // 0–23, hour when sleep begins (default 23 = 11 PM)
  sleepEnd: number    // 0–23, hour when sleep ends / day view starts (default 7 = 7 AM)
  expectedSleepHours: number // nightly sleep target (planner + insights), default 8.5
}

interface SettingsContextValue extends Settings {
  colors: ColorPalette
  setTheme: (t: ThemeMode) => void
  setReduceMotion: (v: boolean) => void
  setSoundOnStop: (v: boolean) => void
  setWeekStartsOn: (v: WeekStart) => void
  setSnapDragTo: (v: SnapDragTo) => void
  setQuickStartCount: (v: QuickStartCount) => void
  setShowWeekTab: (v: boolean) => void
  setHideSleep: (v: boolean) => void
  setSleepStart: (v: number) => void
  setSleepEnd: (v: number) => void
  setExpectedSleepHours: (v: number) => void
}

const defaults: Settings = {
  theme: 'Dark',
  reduceMotion: false,
  soundOnStop: true,
  weekStartsOn: 'Monday',
  snapDragTo: 5,
  quickStartCount: 4,
  showWeekTab: true,
  hideSleep: false,
  sleepStart: 23,
  sleepEnd: 7,
  expectedSleepHours: 8.5,
}

const SettingsContext = createContext<SettingsContextValue>({
  ...defaults,
  colors: darkColors,
  setTheme: () => {},
  setReduceMotion: () => {},
  setSoundOnStop: () => {},
  setWeekStartsOn: () => {},
  setSnapDragTo: () => {},
  setQuickStartCount: () => {},
  setShowWeekTab: () => {},
  setHideSleep: () => {},
  setSleepStart: () => {},
  setSleepEnd: () => {},
  setExpectedSleepHours: () => {},
})

const KEY = '@lifeos_settings'

function normalizeSettings(raw: unknown): Settings {
  const value = typeof raw === 'object' && raw !== null ? raw as Partial<Settings> : {}
  const next = { ...defaults, ...value }
  if (!['Light', 'Dark', 'Auto'].includes(next.theme)) next.theme = defaults.theme
  if (!['Monday', 'Sunday'].includes(next.weekStartsOn)) next.weekStartsOn = defaults.weekStartsOn
  if (![5, 10, 15, 30].includes(next.snapDragTo)) next.snapDragTo = defaults.snapDragTo
  if (![0, 2, 3, 4, 5].includes(next.quickStartCount)) next.quickStartCount = defaults.quickStartCount
  if (typeof next.showWeekTab !== 'boolean') next.showWeekTab = defaults.showWeekTab
  if (typeof next.hideSleep !== 'boolean') next.hideSleep = defaults.hideSleep
  if (typeof next.sleepStart !== 'number' || next.sleepStart < 0 || next.sleepStart > 23) next.sleepStart = defaults.sleepStart
  if (typeof next.sleepEnd !== 'number' || next.sleepEnd < 0 || next.sleepEnd > 23) next.sleepEnd = defaults.sleepEnd
  if (typeof next.expectedSleepHours !== 'number' || next.expectedSleepHours < 4 || next.expectedSleepHours > 12) next.expectedSleepHours = defaults.expectedSleepHours
  return next
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults)
  const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme())

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) setSettings(normalizeSettings(JSON.parse(raw)))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme)
    })
    return () => sub.remove()
  }, [])

  const persist = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = normalizeSettings({ ...prev, ...patch })
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const resolvedColors = useMemo(() => {
    if (settings.theme === 'Light') return lightColors
    if (settings.theme === 'Dark') return darkColors
    return systemScheme === 'light' ? lightColors : darkColors
  }, [settings.theme, systemScheme])

  const value: SettingsContextValue = {
    ...settings,
    colors: resolvedColors,
    setTheme: (t) => persist({ theme: t }),
    setReduceMotion: (v) => persist({ reduceMotion: v }),
    setSoundOnStop: (v) => persist({ soundOnStop: v }),
    setWeekStartsOn: (v) => persist({ weekStartsOn: v }),
    setSnapDragTo: (v) => persist({ snapDragTo: v }),
    setQuickStartCount: (v) => persist({ quickStartCount: v }),
    setShowWeekTab: (v) => persist({ showWeekTab: v }),
    setHideSleep: (v) => persist({ hideSleep: v }),
    setSleepStart: (v) => persist({ sleepStart: v }),
    setSleepEnd: (v) => persist({ sleepEnd: v }),
    setExpectedSleepHours: (v) => persist({ expectedSleepHours: v }),
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  return useContext(SettingsContext)
}
