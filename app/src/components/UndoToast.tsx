import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text } from 'react-native'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'

interface UndoToastProps {
  message: string
  colors: ColorPalette
  onUndo: () => void
  onHide: () => void
  reduceMotion?: boolean
  durationMs?: number
}

/**
 * Transient bottom toast with an Undo action. Auto-dismisses after `durationMs`.
 * Re-mount (via a `key`) to restart its timer for a fresh action.
 */
export function UndoToast({ message, colors, onUndo, onHide, reduceMotion, durationMs = 5000 }: UndoToastProps) {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current

  useEffect(() => {
    if (!reduceMotion) {
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    }
    const t = setTimeout(onHide, durationMs)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="box-none">
      <Pressable style={[styles.toast, { backgroundColor: colors.surface3, borderColor: colors.border2 }]}>
        <Text style={[styles.msg, { color: colors.text1 }]} numberOfLines={1}>{message}</Text>
        <Pressable onPress={onUndo} hitSlop={10}>
          <Text style={[styles.undo, { color: colors.text1 }]}>UNDO</Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center', paddingHorizontal: 20 },
  toast: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20,
    borderWidth: 1, borderRadius: 999, paddingLeft: 20, paddingRight: 16, paddingVertical: 12,
    maxWidth: 420, minWidth: 240,
  },
  msg: { flex: 1, fontSize: 14, fontFamily: fonts.ui },
  undo: { fontSize: 13, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 1 },
})
