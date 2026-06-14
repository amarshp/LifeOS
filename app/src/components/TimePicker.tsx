import { useRef } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, type ViewStyle } from 'react-native'
import { fonts } from '../theme/tokens'
import { useSettings } from '../contexts/SettingsContext'

interface TimePickerProps {
  label: string
  hour: string
  minute: string
  period: 'AM' | 'PM'
  onHourChange: (v: string) => void
  onMinuteChange: (v: string) => void
  onPeriodToggle: () => void
  placeholder?: string
  labelStyle?: ViewStyle
  style?: ViewStyle
}

export function TimePicker({
  label,
  hour, minute, period,
  onHourChange, onMinuteChange, onPeriodToggle,
  placeholder,
  labelStyle,
  style,
}: TimePickerProps) {
  const { colors: tc } = useSettings()
  const minuteRef = useRef<TextInput>(null)
  const hourRef = useRef<TextInput>(null)

  return (
    <View style={style}>
      <Text style={[styles.label, { color: tc.text3 }, labelStyle]}>{label}</Text>
      <View style={[styles.row, { borderBottomColor: tc.border2 }]}>
        <TextInput
          ref={hourRef}
          value={hour}
          onChangeText={(v) => {
            onHourChange(v)
            if (v.length === 2) minuteRef.current?.focus()
          }}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={placeholder ? '--' : undefined}
          placeholderTextColor={tc.text5}
          style={[styles.input, { color: tc.text1 }]}
        />
        <Text style={[styles.colon, { color: tc.text4 }]}>:</Text>
        <TextInput
          ref={minuteRef}
          value={minute}
          onChangeText={onMinuteChange}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === 'Backspace' && minute === '') {
              hourRef.current?.focus()
            }
          }}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={placeholder ? '--' : undefined}
          placeholderTextColor={tc.text5}
          style={[styles.input, { color: tc.text1 }]}
        />
        <Pressable
          onPress={onPeriodToggle}
          style={[styles.ampmBtn, { backgroundColor: tc.surface3 }]}
        >
          <Text style={[styles.ampmText, { color: tc.text2 }]}>{period}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
    fontFamily: fonts.ui,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  input: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.displayMedium,
    fontWeight: '500',
    width: 28,
    textAlign: 'center',
    letterSpacing: -0.18,
  },
  colon: {
    fontSize: 18,
    fontFamily: fonts.display,
  },
  ampmBtn: {
    marginLeft: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ampmText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: fonts.ui,
    letterSpacing: 0.5,
  },
})
