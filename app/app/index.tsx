import { View } from 'react-native'
import { colors } from '../src/theme/tokens'

// Root "/" placeholder shown for the instant before AuthGate redirects.
// Without a screen here the router has nothing to render at launch.
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />
}
