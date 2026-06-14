import { useId } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg'

interface PlannedBlockPatternProps {
  color: string
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
}

export function PlannedBlockPattern({
  color,
  fillOpacity = 0.07,
  strokeOpacity = 0.55,
  strokeWidth = 1.4,
}: PlannedBlockPatternProps) {
  const patternId = `planned-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const gap = 9

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
    >
      <Rect x="0" y="0" width="100%" height="100%" fill={color} opacity={fillOpacity} />
      <Defs>
        <Pattern id={patternId} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Line
            x1="0"
            y1="0"
            x2="0"
            y2={gap}
            stroke={color}
            strokeWidth={strokeWidth}
            opacity={strokeOpacity}
          />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  )
}
