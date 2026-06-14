export interface TimelineTick {
  minutes: number
  topPct: number
  label: string
  showLabel: boolean
  isMajor: boolean
}

export function getTimelineGranularity(zoom: number): { labelMinutes: number; gridMinutes: number } {
  if (zoom >= 3) return { labelMinutes: 15, gridMinutes: 5 }
  if (zoom >= 1.8) return { labelMinutes: 30, gridMinutes: 15 }
  if (zoom >= 0.85) return { labelMinutes: 60, gridMinutes: 30 }
  return { labelMinutes: 120, gridMinutes: 60 }
}

export function createTimelineTicks(startHour: number, endHour: number, zoom: number): TimelineTick[] {
  const { labelMinutes, gridMinutes } = getTimelineGranularity(zoom)
  const startMinutes = startHour * 60
  const endMinutes = endHour * 60
  const totalMinutes = endMinutes - startMinutes
  const ticks: TimelineTick[] = []

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += gridMinutes) {
    const relativeMinutes = minutes - startMinutes
    const showLabel = relativeMinutes % labelMinutes === 0
    ticks.push({
      minutes,
      topPct: totalMinutes > 0 ? relativeMinutes / totalMinutes : 0,
      label: formatTimelineLabel(minutes),
      showLabel,
      isMajor: relativeMinutes % 60 === 0,
    })
  }

  return ticks
}

function formatTimelineLabel(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hour24 = Math.floor(normalized / 60)
  const minute = normalized % 60
  const hour12 = hour24 % 12 || 12
  const suffix = hour24 < 12 ? 'a' : 'p'

  return minute === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minute).padStart(2, '0')}${suffix}`
}
