import { View, Text, Pressable, StyleSheet, Animated, Alert } from 'react-native'
import { Tabs, useFocusEffect, useRouter, usePathname } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts } from '../../src/theme/tokens'
import { HomeIcon, DayIcon, WeekIcon, InsightsIcon, SettingsIcon, NumberIcon } from '../../src/components/TabIcons'
import { useTimer, formatElapsed } from '../../src/hooks/useTimer'
import { useSettings } from '../../src/contexts/SettingsContext'
import * as categoriesService from '../../src/services/categories'
import { reconcileLiveActivities } from '../../src/lib/liveActivity'
import * as Linking from 'expo-linking'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category } from '../../src/types/database'
import { toLocalDateStr } from '../../src/lib/date'

const BLOOD_RED = '#C8102E'

export default function TabLayout() {
  const timer = useTimer()
  const router = useRouter()
  const { colors, showWeekTab } = useSettings()
  const [categories, setCategories] = useState<Category[]>([])
  const [stoppingEntryId, setStoppingEntryId] = useState<string | null>(null)

  useFocusEffect(useCallback(() => {
    categoriesService.getCategories().then(setCategories).catch(() => {})
    timer.refresh()
  }, [timer.refresh]))

  const currentEntry = timer.running[0]
  const currentCat = currentEntry ? categories.find(c => c.id === currentEntry.category_id) : undefined
  const runningCount = timer.running.length

  // Sync running timers -> iOS Live Activities (Dynamic Island + Lock Screen).
  // Single instance: this tab root mounts once.
  useEffect(() => {
    const nameById: Record<string, string> = {}
    for (const c of categories) nameById[c.id] = c.name
    reconcileLiveActivities(timer.running, nameById).catch(() => {})
  }, [timer.running, categories])

  const pulseAnim = useRef(new Animated.Value(1)).current
  const pulseAnimRef = useRef(pulseAnim)
  useEffect(() => {
    const anim = pulseAnimRef.current
    if (!currentEntry) {
      anim.stopAnimation()
      anim.setValue(1)
      return
    }
    // lub-dub at 72bpm — cycle: 80+100+60+80+513 = 833ms
    anim.setValue(1)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.7,  duration: 80,  useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.85, duration: 100, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1.4,  duration: 60,  useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1.0,  duration: 80,  useNativeDriver: true }),
        Animated.delay(513),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [currentEntry?.id])

  const pathname = usePathname()
  const isHome = pathname === '/' || pathname === '/test3'

  const openRunningEntry = useCallback(() => {
    if (!currentEntry) return
    router.push({
      pathname: '/(tabs)/day',
      params: {
        date: toLocalDateStr(new Date()),
        editEntry: currentEntry.id,
        focusTs: String(Date.now()),
      },
    })
  }, [currentEntry, router])

  const openStartTimerSheet = useCallback(() => {
    router.push({
      pathname: '/(tabs)/day',
      params: { sheet: 'entry', focusTs: String(Date.now()) },
    })
  }, [router])

  const stopAndOpenStartTimer = useCallback(async (entryId: string) => {
    if (stoppingEntryId) return
    setStoppingEntryId(entryId)
    try {
      await timer.stop(entryId)
      openStartTimerSheet()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to stop timer'
      Alert.alert('Error', msg)
    } finally {
      setStoppingEntryId(null)
    }
  }, [openStartTimerSheet, stoppingEntryId, timer])

  // Handle the Live Activity STOP button deep link: lifeos://stop-start?entry=ID
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return
      const parsed = Linking.parse(url)
      const isStopStart = parsed.hostname === 'stop-start' || parsed.path === 'stop-start'
      const entry = parsed.queryParams?.entry
      if (isStopStart && typeof entry === 'string') {
        void stopAndOpenStartTimer(entry)
      }
    }
    Linking.getInitialURL().then(handle).catch(() => {})
    const sub = Linking.addEventListener('url', (e) => handle(e.url))
    return () => sub.remove()
  }, [stopAndOpenStartTimer])

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {currentEntry && !isHome && (
        <Pressable
          style={[bannerStyles.bar, { backgroundColor: colors.surface1, borderBottomColor: colors.border }]}
          onPress={openRunningEntry}
        >
          <Animated.View style={[bannerStyles.pulse, { backgroundColor: currentCat?.color ?? BLOOD_RED, transform: [{ scale: pulseAnim }] }]} />
          <View style={bannerStyles.info}>
            <Text style={[bannerStyles.title, { color: colors.text1 }]} numberOfLines={1}>
              {currentEntry.title}
            </Text>
          </View>
          {runningCount > 1 && (
            <View style={[bannerStyles.countBadge, { borderColor: colors.border3 }]}>
              <Text style={[bannerStyles.countText, { color: colors.text2 }]}>{runningCount}</Text>
            </View>
          )}
          <View style={[bannerStyles.divider, { backgroundColor: colors.border2 }]} />
          <Text style={[bannerStyles.timer, { color: colors.text1 }]}>
            {formatElapsed(timer.elapsed[currentEntry.id] ?? 0)}
          </Text>
          <Pressable
            onPress={(event) => {
              event.stopPropagation()
              void stopAndOpenStartTimer(currentEntry.id)
            }}
            disabled={stoppingEntryId === currentEntry.id}
            style={[bannerStyles.stopBtn, { borderColor: colors.border3 }]}
          >
            <View style={[bannerStyles.stopSquare, { backgroundColor: colors.text3 }]} />
          </Pressable>
        </Pressable>
      )}
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 10,
            paddingBottom: 28,
            height: 82,
          },
          tabBarActiveTintColor: colors.text1,
          tabBarInactiveTintColor: colors.text4,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '400',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            fontFamily: fonts.ui,
            marginTop: 5,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="test3"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <HomeIcon color={color as string} size={22} />,
          }}
        />
        <Tabs.Screen
          name="day"
          options={{
            title: 'Day',
            tabBarIcon: ({ color }) => <DayIcon color={color as string} size={22} />,
          }}
        />
        <Tabs.Screen
          name="week"
          options={{
            title: 'Week',
            tabBarIcon: ({ color }) => <WeekIcon color={color as string} size={22} />,
            href: showWeekTab ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="insights"
          options={{
            title: 'Insights',
            tabBarIcon: ({ color }) => <InsightsIcon color={color as string} size={22} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color }) => <SettingsIcon color={color as string} size={22} />,
          }}
        />
      </Tabs>
    </SafeAreaView>
  )
}

const bannerStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignSelf: 'center',
    marginLeft: 14,
  },
  info: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fonts.displaySemiBold,
    letterSpacing: -0.2,
  },
  cat: {
    fontSize: 13,
    fontFamily: fonts.displayItalic,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
  },
  divider: {
    width: 1,
    height: 26,
  },
  timer: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.displayBold,
    letterSpacing: -1,
  },
  stopBtn: {
    width: 30,
    height: 30,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 10,
    height: 10,
    borderRadius: 1,
  },
})
