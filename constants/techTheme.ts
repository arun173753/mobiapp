// UX Pilot Dark Theme for Technician App
// Design tokens extracted from UX Pilot export

export const T = {
  // Backgrounds
  bg: '#121212',
  bgElevated: '#181818',
  card: '#1E1E1E',
  cardSurface: '#2A2A2A',
  cardHighlight: '#333333',

  // Borders
  border: '#2C2C2C',
  borderLight: '#374151',

  // Text
  text: '#F3F4F6',
  textSub: '#D1D5DB',
  muted: '#9CA3AF',
  placeholder: '#6B7280',

  // Brand
  accent: '#FF6B2C',
  accentMuted: 'rgba(255,107,44,0.15)',
  accentGlow: 'rgba(255,107,44,0.08)',

  // Semantic
  blue: '#3B82F6',
  blueMuted: 'rgba(59,130,246,0.15)',
  green: '#10B981',
  greenMuted: 'rgba(16,185,129,0.15)',
  red: '#EF4444',
  redMuted: 'rgba(239,68,68,0.15)',
  yellow: '#F59E0B',
  yellowMuted: 'rgba(245,158,11,0.15)',
  purple: '#8B5CF6',
  purpleMuted: 'rgba(139,92,246,0.15)',

  // Badges
  techBadge: '#10B981',
  customerBadge: '#F59E0B',

  // Gradients (for use as array)
  gradientCard: ['#1E1E1E', '#161616'],
  gradientAccent: ['#FF6B2C', '#FF8F5E'],

  // Spacing
  radius: 16,
  radiusSm: 10,
  radiusLg: 24,
  radiusXl: 32,

  // Shadows
  shadowColor: '#000000',
  shadowOpacity: 0.4,
};

// Post category colors (for badge pills)
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  repair:   { bg: T.blueMuted,   text: T.blue,   border: 'rgba(59,130,246,0.3)' },
  job:      { bg: T.greenMuted,  text: T.green,  border: 'rgba(16,185,129,0.3)' },
  training: { bg: T.purpleMuted, text: T.purple, border: 'rgba(139,92,246,0.3)' },
  supplier: { bg: T.accentMuted, text: T.accent, border: 'rgba(255,107,44,0.3)' },
  sell:     { bg: T.yellowMuted, text: T.yellow, border: 'rgba(245,158,11,0.3)' },
  question: { bg: T.yellowMuted, text: T.yellow, border: 'rgba(245,158,11,0.3)' },
  all:      { bg: T.card,        text: T.text,   border: T.border },
};

export const CATEGORY_ICONS: Record<string, string> = {
  repair:   'construct',
  job:      'briefcase',
  training: 'school',
  supplier: 'cube',
  sell:     'pricetag',
  question: 'help-circle',
};

export default T;
