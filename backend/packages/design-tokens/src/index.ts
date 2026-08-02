export const palette = {
  ink: "#14201C",
  inkMuted: "#51605A",
  canvas: "#F6F8F4",
  surface: "#FFFFFF",
  line: "#DCE3DD",
  brand: "#176B4D",
  brandStrong: "#0D4C35",
  clear: "#277A52",
  attention: "#A35D09",
  blocked: "#B42318",
  info: "#2463A8",
  onStrong: "#FFFFFF",
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
export const radius = { none: 0, sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const typography = {
  family: { sans: "Inter", mono: "JetBrains Mono" },
  size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 36 },
  lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.7 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;
export const breakpoints = { compact: 480, tablet: 768, desktop: 1_024, wide: 1_440 } as const;
export const motion = { fastMs: 120, normalMs: 200, slowMs: 320 } as const;
export const reviewState = {
  clear: { foreground: palette.clear, label: "Clear" },
  attention: { foreground: palette.attention, label: "Needs attention" },
  blocked: { foreground: palette.blocked, label: "Blocked" },
} as const;

export type ReviewStateToken = keyof typeof reviewState;
