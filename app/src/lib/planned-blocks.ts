import type { CalendarBlock } from '../types/database'

export function getVisiblePlannedBlock(block: CalendarBlock, now: Date = new Date()): CalendarBlock | null {
  const nowMs = now.getTime()
  const startMs = new Date(block.start_time).getTime()
  const endMs = new Date(block.end_time).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return block
  if (endMs <= nowMs) return null
  if (startMs < nowMs) {
    return { ...block, start_time: now.toISOString() }
  }
  return block
}

export function getVisiblePlannedBlocks(blocks: CalendarBlock[], now: Date = new Date()): CalendarBlock[] {
  return blocks.flatMap(block => {
    const visible = getVisiblePlannedBlock(block, now)
    return visible ? [visible] : []
  })
}
