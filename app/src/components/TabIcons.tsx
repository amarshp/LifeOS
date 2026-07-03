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

export function TasksIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path d="M5 5.5l1.3 1.3L8.5 4.5M5 11l1.3 1.3L8.5 10M5 16.5l1.3 1.3 2.2-2.3" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11 5.5h6M11 11h6M11 16.5h6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  )
}

export function PlanIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M4 4h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 14H8l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 4z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="M6.5 7.5h7M6.5 10.5h4" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
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
