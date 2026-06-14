const listeners = new Set<() => void>()

export function emitTimerChange() {
  for (const listener of listeners) listener()
}

export function subscribeTimerChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
