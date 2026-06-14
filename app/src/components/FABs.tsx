import { View, Pressable, StyleSheet } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { colors } from '../theme/tokens'
import { useSettings } from '../contexts/SettingsContext'

interface FABsProps {
  onPress: () => void
}

export function FABs({ onPress }: FABsProps) {
  const { colors: tc } = useSettings()
  return (
    <View style={styles.container}>
      <Pressable style={[styles.primary, { backgroundColor: tc.text1 }]} onPress={onPress}>
        <Svg width={24} height={24} viewBox="0 0 16 16" fill="none">
          <Path d="M8 3v10M3 8h10" stroke={tc.bg} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    right: 18,
    alignItems: 'center',
  },
  primary: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.text1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
