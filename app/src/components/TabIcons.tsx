import { View, Text } from 'react-native'
import Svg, { Path, Rect, Circle } from 'react-native-svg'
import { fonts } from '../theme/tokens'

interface IconProps {
  color: string
  size?: number
}

/** A numbered tab glyph (rounded square + digit) for the test variant tabs. */
export function NumberIcon({ color, size = 20, n }: IconProps & { n: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        borderWidth: 1.6,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color, fontSize: Math.round(size * 0.58), fontWeight: '700', fontFamily: fonts.ui, lineHeight: Math.round(size * 0.7) }}>
        {n}
      </Text>
    </View>
  )
}

export function HomeIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path d="M3 9.5L10 3l7 6.5V17H3V9.5z" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  )
}

export function DayIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={4} y={3} width={12} height={14} rx={2} stroke={color} strokeWidth={1.6} />
      <Path d="M4 7h12" stroke={color} strokeWidth={1.6} />
    </Svg>
  )
}

export function WeekIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={3} y={4} width={14} height={13} rx={2} stroke={color} strokeWidth={1.6} />
      <Path d="M3 8h14M7 4v13M13 4v13" stroke={color} strokeWidth={1.6} />
    </Svg>
  )
}

export function InsightsIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={3} y={10} width={4} height={7} rx={1} stroke={color} strokeWidth={1.6} />
      <Rect x={8} y={6} width={4} height={11} rx={1} stroke={color} strokeWidth={1.6} />
      <Rect x={13} y={3} width={4} height={14} rx={1} stroke={color} strokeWidth={1.6} />
    </Svg>
  )
}

export function SettingsIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Circle cx={10} cy={10} r={2.5} stroke={color} strokeWidth={1.6} />
      <Path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  )
}
