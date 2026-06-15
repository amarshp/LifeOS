import { Redirect } from 'expo-router'

// Deep-link target for a Live Activity card BODY tap (lifeos://home).
// Just opens the app on the Home tab — the red STOP button has its own
// deep link (lifeos://stop-start?entry=…) that stops the timer instead.
export default function HomeDeepLink() {
  return <Redirect href="/(tabs)/test3" />
}
