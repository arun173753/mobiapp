import { Colors } from './colors';
import { Spacing } from './spacing';

export const Theme = {
  colors: Colors,
  spacing: Spacing,
  radius: {
    sm: 12,
    md: 16,
    lg: 22,
  },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    } as const,
  },
};

