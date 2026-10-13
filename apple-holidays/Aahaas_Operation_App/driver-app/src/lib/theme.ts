/**
 * Aahaas brand theme — clean white surfaces, Aahaas red (#FF2638, the logo's
 * colour) for the one thing to do next, deep ink text for sunlight legibility.
 */
export const C = {
  bg: '#F5F6FA',
  card: '#FFFFFF',
  cardHi: '#F0F2F7',
  line: '#E3E6EE',
  text: '#0E1525',
  sub: '#5A6478',
  dim: '#98A2B5',
  red: '#FF2638',
  redDeep: '#D9142A',
  redSoft: '#FFEDEF',
  gold: '#C98A00',
  goldSoft: '#FFF6DF',
  green: '#0E9F6E',
  greenSoft: '#E5F7F0',
  blue: '#2563EB',
  blueSoft: '#EBF1FF',
  amber: '#D97706',
  ink: '#0E1525',
  onBrand: '#FFFFFF',
};

export const R = { sm: 10, md: 16, lg: 24, xl: 32 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Soft card shadow used across the app. */
export const shadow = {
  shadowColor: '#0E1525', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
} as const;
