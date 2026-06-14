import { View, Text, StyleSheet } from 'react-native'
import { useMemo } from 'react'
import { colors, fonts } from '../theme/tokens'
import { useSettings } from '../contexts/SettingsContext'
import { getVisiblePlannedBlocks } from '../lib/planned-blocks'
import { useNow } from '../hooks/useNow'
import type { CalendarBlock, TimeEntry, Category } from '../types/database'

interface MiniTimelineProps {
  blocks: CalendarBlock[]
  entries: TimeEntry[]
  categories?: Category[]
  startHour?: number
  endHour?: number
}

function getCatColor(catId: string, fallback: string, categories?: Category[]): string {
  return categories?.find(c => c.id === catId)?.color ?? fallback
}

export function MiniTimeline({
  blocks,
  entries,
  categories,
  startHour = 0,
  endHour = 24,
}: MiniTimelineProps) {
  const { colors: tc } = useSettings()
  const now = useNow()
  const visibleBlocks = useMemo(() => getVisiblePlannedBlocks(blocks, now), [blocks, now])
  const totalHours = endHour - startHour

  function getPosition(time: string): number {
    const d = new Date(time)
    const hours = d.getHours() + d.getMinutes() / 60
    return ((hours - startHour) / totalHours) * 100
  }

  function getWidth(start: string, end: string): number {
    const s = new Date(start)
    const e = new Date(end)
    const durationHours = (e.getTime() - s.getTime()) / (1000 * 60 * 60)
    return (durationHours / totalHours) * 100
  }

  const nowHours = now.getHours() + now.getMinutes() / 60
  const nowPct = ((nowHours - startHour) / totalHours) * 100

  const tickHours = [0, 4, 8, 12, 16, 20, 24].filter(h => h >= startHour && h <= endHour)

  return (
    <View>
      {/* Hour tick labels */}
      <View style={styles.tickRow}>
        {tickHours.map(h => {
          const pct = ((h - startHour) / totalHours) * 100
          const label = h === 0 ? '12a' : h === 12 ? '12p' : h === 24 ? '12a' : `${h % 12}${h < 12 ? 'a' : 'p'}`
          return (
            <Text key={h} style={[styles.tickLabel, { left: `${pct}%`, color: tc.text4 }]}>{label}</Text>
          )
        })}
      </View>

      {/* Rail */}
      <View style={[styles.rail, { borderBottomColor: tc.border }]}>
        {/* Actual entries */}
        {entries.map(entry => {
          const end = entry.end_time ?? new Date().toISOString()
          const left = getPosition(entry.start_time)
          const width = getWidth(entry.start_time, end)
          const catColor = getCatColor(entry.category_id, tc.text3, categories)
          return (
            <View
              key={entry.id}
              style={[styles.block, { left: `${left}%`, width: `${Math.max(width, 0.5)}%`, backgroundColor: catColor }]}
            />
          )
        })}
        {/* Planned blocks */}
        {visibleBlocks.map(block => {
          const left = getPosition(block.start_time)
          const width = getWidth(block.start_time, block.end_time)
          const catColor = getCatColor(block.category_id, tc.text3, categories)
          return (
            <View
              key={block.id}
              style={[styles.block, { left: `${left}%`, width: `${Math.max(width, 0.5)}%`, borderWidth: 1, borderColor: catColor, backgroundColor: 'transparent' }]}
            />
          )
        })}
        {/* Now indicator */}
        {nowPct > 0 && nowPct < 100 && (
          <>
            <View style={[styles.nowLine, { left: `${nowPct}%`, backgroundColor: tc.text1 }]} />
            <View style={[styles.nowDot, { left: `${nowPct}%`, backgroundColor: tc.text1 }]} />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  tickRow: {
    position: 'relative',
    height: 14,
    marginBottom: 4,
  },
  tickLabel: {
    position: 'absolute',
    top: 0,
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.text4,
    fontFamily: fonts.ui,
    fontVariant: ['tabular-nums'],
    transform: [{ translateX: -8 }],
  },
  rail: {
    height: 22,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  block: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 2,
    minWidth: 2,
    overflow: 'hidden',
  },
  nowLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.text1,
  },
  nowDot: {
    position: 'absolute',
    top: -3,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.text1,
    marginLeft: -3,
  },
})
