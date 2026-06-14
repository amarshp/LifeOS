import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as timeEntries from '../src/services/time-entries'
import { emitTimerChange } from '../src/lib/timer-events'
import { toLocalDateStr } from '../src/lib/date'
import { colors } from '../src/theme/tokens'

// Target of the Live Activity STOP button (lifeos://stop-start?entry=ID).
// Stops the given timer, then redirects to the Day view with the start sheet
// open so the user can begin another. A real route avoids the not-found flash.
export default function StopStartScreen() {
  const { entry } = useLocalSearchParams<{ entry?: string }>()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    ;(async () => {
      try {
        if (entry) {
          await timeEntries.stopTimer(entry)
          emitTimerChange()
        }
      } catch {
        // ignore — already stopped / offline; still open the start sheet
      }
      router.replace({
        pathname: '/(tabs)/day',
        params: { date: toLocalDateStr(new Date()), sheet: 'entry', focusTs: String(Date.now()) },
      })
    })()
  }, [entry, router])

  return <View style={{ flex: 1, backgroundColor: colors.bg }} />
}
