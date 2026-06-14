import { Pressable, View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme/tokens'
import { useSettings } from '../contexts/SettingsContext'

interface CategoryChipProps {
  name: string
  color: string
  selected?: boolean
  onPress?: () => void
}

export function CategoryChip({ name, color, selected, onPress }: CategoryChipProps) {
  const { colors: tc } = useSettings()
  return (
    <Pressable
      style={[styles.chip, { borderColor: tc.border2 }, selected && [styles.selected, { backgroundColor: tc.text1, borderColor: tc.text1 }]]}
      onPress={onPress}
    >
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[styles.label, { color: selected ? tc.bg : tc.text2 }]}>{name}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border2,
  },
  selected: {
    backgroundColor: colors.text1,
    borderColor: colors.text1,
  },
  swatch: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    color: colors.text2,
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.12,
    fontFamily: fonts.ui,
  },
})
