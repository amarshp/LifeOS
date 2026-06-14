import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme/tokens'
import type { TimeEntry, Category } from '../types/database'
import { formatElapsed } from '../hooks/useTimer'
import { useSettings } from '../contexts/SettingsContext'

interface RunnerBannerProps {
  entry: TimeEntry
  category: Category | undefined
  elapsed: number
  onStop: () => void
}

export function RunnerBanner({ entry, category, elapsed, onStop }: RunnerBannerProps) {
  const { colors: tc } = useSettings()
  const catColor = category?.color ?? tc.text3

  return (
    <View style={[styles.container, { borderBottomColor: tc.border }]}>
      <View style={[styles.dot, { backgroundColor: catColor }]} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: tc.text1 }]} numberOfLines={1}>{entry.title}</Text>
        <Text style={[styles.meta, { color: tc.text3 }]}>{category?.name ?? 'Uncategorized'}</Text>
      </View>
      <Text style={[styles.timer, { color: tc.text1 }]}>{formatElapsed(elapsed)}</Text>
      <Pressable onPress={onStop} style={[styles.stopBtn, { borderColor: tc.text4 }]}>
        <View style={[styles.stopSquare, { backgroundColor: tc.text1 }]} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 22,
    marginTop: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.text1,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: fonts.displayMedium,
    letterSpacing: -0.15,
  },
  meta: {
    color: colors.text3,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  timer: {
    color: colors.text1,
    fontSize: 12.5,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.mono,
  },
  stopBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.text4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: colors.text1,
  },
})
