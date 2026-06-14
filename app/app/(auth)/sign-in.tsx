import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '../../src/contexts/AuthContext'
import { colors, fonts } from '../../src/theme/tokens'

export default function SignInScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    if (!email || !password) return
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign in failed'
      Alert.alert('Error', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.brand}>LifeOS</Text>
        <Text style={styles.subtitle}>Plan your time. Track what happens.</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.text4}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.text4}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Pressable style={styles.button} onPress={handleSignIn} disabled={loading}>
          <Text style={styles.buttonText}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Text>
        </Pressable>

        <Link href="/(auth)/sign-up" style={styles.link}>
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: 28 },
  brand: {
    fontFamily: fonts.displayBold,
    fontSize: 48,
    fontWeight: '700',
    color: colors.text1,
    letterSpacing: -1.9,
  },
  subtitle: {
    color: colors.text2,
    fontSize: 13.5,
    marginTop: 8,
    marginBottom: 40,
    fontFamily: fonts.ui,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: 16,
    color: colors.text1,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.ui,
  },
  button: {
    backgroundColor: colors.text1,
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: colors.bg,
    fontWeight: '400',
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  link: { marginTop: 20, alignSelf: 'center' },
  linkText: {
    color: colors.text2,
    fontSize: 14,
    fontFamily: fonts.ui,
  },
})
