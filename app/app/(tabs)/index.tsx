import { Redirect } from 'expo-router'

/**
 * The Home tab is `test3.tsx` ("The Monolith"). This index route only exists so
 * `/(tabs)` has a landing target — it redirects to the canonical home.
 * The previous standalone home design is archived at `_archive/home-index.tsx.bak`.
 */
export default function TabsIndex() {
  return <Redirect href="/(tabs)/test3" />
}
