import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { ReactNode } from 'react'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'

// Big segmented header shared by the Day and Tasks surfaces — they live in one
// tab. Deliberately NOT the small pill toggle: two display-font titles, the
// active one lit. Same pattern as the shipped Plan/Tasks v2 header.

interface DayTasksSwitchProps {
  active: 'day' | 'tasks'
  onSwitch: (target: 'day' | 'tasks') => void
  colors: ColorPalette
  right?: ReactNode // optional control pinned to the right edge (e.g. insights)
}

export function DayTasksSwitch({ active, onSwitch, colors: tc, right }: DayTasksSwitchProps) {
  return (
    <View style={styles.row}>
      <View style={styles.center}>
        <Pressable onPress={() => active !== 'day' && onSwitch('day')} hitSlop={10}>
          <Text style={[styles.label, { color: active === 'day' ? tc.text1 : tc.text4 }]}>Day</Text>
        </Pressable>
        <Text style={[styles.sep, { color: tc.text4 }]}>·</Text>
        <Pressable onPress={() => active !== 'tasks' && onSwitch('tasks')} hitSlop={10}>
          <Text style={[styles.label, { color: active === 'tasks' ? tc.text1 : tc.text4 }]}>Tasks</Text>
        </Pressable>
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 2,
  },
  center: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  label: {
    fontSize: 21,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    letterSpacing: -0.4,
  },
  sep: { fontSize: 18, fontFamily: fonts.displayBold },
  right: { position: 'absolute', right: 18 },
})
