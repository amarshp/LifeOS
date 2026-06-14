import { Platform } from 'react-native'

export const darkColors = {
  bg: '#0E0C0A',
  surface1: '#1A1814',
  surface2: '#16140F',
  surface3: '#221F18',
  border: '#2A251E',
  border2: '#3A352D',
  border3: '#5A5448',

  text1: '#F5F2EC',
  text2: '#C8C2B3',
  text3: '#8A8478',
  text4: '#5A5448',
  text5: '#3A352D',

  categories: {
    deep: '#9B8EC0',
    study: '#8BB4CC',
    admin: '#CCAA6B',
    gym: '#8FBF8A',
    break: '#CCA8A8',
    commute: '#8AAFAF',
  },
} as const

export const lightColors = {
  bg: '#F5F2EC',
  surface1: '#FFFFFF',
  surface2: '#FAF8F2',
  surface3: '#F0EDE5',
  border: '#E4DFD4',
  border2: '#D8D2C4',
  border3: '#B8B3A7',

  text1: '#0A0908',
  text2: '#3F3C36',
  text3: '#7A766C',
  text4: '#B8B3A7',
  text5: '#D8D3C5',

  categories: {
    deep: '#9B8EC0',
    study: '#8BB4CC',
    admin: '#CCAA6B',
    gym: '#8FBF8A',
    break: '#CCA8A8',
    commute: '#8AAFAF',
  },
} as const

export interface ColorPalette {
  bg: string
  surface1: string
  surface2: string
  surface3: string
  border: string
  border2: string
  border3: string
  text1: string
  text2: string
  text3: string
  text4: string
  text5: string
  categories: {
    deep: string
    study: string
    admin: string
    gym: string
    break: string
    commute: string
  }
}

export const colors: ColorPalette = darkColors

export const categoryList = [
  { key: 'deep', name: 'Deep Work', color: colors.categories.deep },
  { key: 'study', name: 'Study', color: colors.categories.study },
  { key: 'admin', name: 'Admin', color: colors.categories.admin },
  { key: 'gym', name: 'Gym', color: colors.categories.gym },
  { key: 'break', name: 'Break', color: colors.categories.break },
  { key: 'commute', name: 'Commute', color: colors.categories.commute },
] as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

export const radii = {
  block: 4,
  input: 12,
  card: 14,
  pill: 999,
} as const

const playfair = Platform.select({
  web: '"Playfair Display", "Times New Roman", serif',
  default: 'PlayfairDisplay_400Regular',
})

const playfairMedium = Platform.select({
  web: '"Playfair Display", "Times New Roman", serif',
  default: 'PlayfairDisplay_500Medium',
})

const playfairSemiBold = Platform.select({
  web: '"Playfair Display", "Times New Roman", serif',
  default: 'PlayfairDisplay_600SemiBold',
})

const playfairBold = Platform.select({
  web: '"Playfair Display", "Times New Roman", serif',
  default: 'PlayfairDisplay_700Bold',
})

const playfairItalic = Platform.select({
  web: '"Playfair Display", "Times New Roman", serif',
  default: 'PlayfairDisplay_500Medium_Italic',
})

const inter = Platform.select({
  web: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  default: undefined,
})

const mono = Platform.select({
  web: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  default: 'JetBrainsMono_400Regular',
})

export const fonts = {
  display: playfair,
  displayMedium: playfairMedium,
  displaySemiBold: playfairSemiBold,
  displayBold: playfairBold,
  displayItalic: playfairItalic,
  ui: inter,
  mono,
} as const

export const typography = {
  display: {
    fontSize: 72,
    fontWeight: '700' as const,
    letterSpacing: -2.9,
    fontFamily: playfairBold,
  },
  h1: {
    fontSize: 40,
    fontWeight: '700' as const,
    letterSpacing: -1,
    fontFamily: playfairBold,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.36,
    fontFamily: playfairBold,
  },
  h3: {
    fontSize: 19,
    fontWeight: '600' as const,
    letterSpacing: -0.19,
    fontFamily: playfairSemiBold,
  },
  body: {
    fontSize: 13.5,
    fontWeight: '400' as const,
    fontFamily: inter,
  },
  caption: {
    fontSize: 12.5,
    fontWeight: '400' as const,
    fontFamily: inter,
  },
  eyebrow: {
    fontSize: 9.5,
    fontWeight: '600' as const,
    letterSpacing: 2.3,
    textTransform: 'uppercase' as const,
    fontFamily: inter,
  },
  num: {
    fontSize: 12,
    fontWeight: '500' as const,
    fontStyle: 'italic' as const,
    letterSpacing: 0.72,
    fontFamily: playfairItalic,
  },
  metaSm: {
    fontSize: 11.5,
    fontWeight: '400' as const,
    fontFamily: inter,
  },
  mono: {
    fontSize: 12.5,
    fontWeight: '400' as const,
    fontVariant: ['tabular-nums'] as const,
    fontFamily: mono,
  },
} as const
