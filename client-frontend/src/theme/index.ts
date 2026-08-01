import { palette, radius, spacing, typography } from "@spotter/design-tokens";
import { StyleSheet } from "react-native";

export const theme = {
  colors: {
    ...palette,
    canvasElevated: "#EEF3EE",
    disabled: "#A9B3AD",
    focus: "#6BAA91",
    overlay: "rgba(20, 32, 28, 0.08)",
  },
  radius,
  spacing,
  typography,
} as const;

export const sharedStyles = StyleSheet.create({
  body: {
    color: theme.colors.ink,
    fontSize: typography.size.md,
    lineHeight: typography.size.md * typography.lineHeight.normal,
  },
  caption: {
    color: theme.colors.inkMuted,
    fontSize: typography.size.sm,
    lineHeight: typography.size.sm * typography.lineHeight.normal,
  },
  heading: {
    color: theme.colors.ink,
    fontSize: typography.size.xl,
    fontWeight: "700",
    lineHeight: typography.size.xl * typography.lineHeight.tight,
  },
  screen: {
    backgroundColor: theme.colors.canvas,
    flex: 1,
  },
  sectionHeading: {
    color: theme.colors.ink,
    fontSize: typography.size.lg,
    fontWeight: "600",
    lineHeight: typography.size.lg * typography.lineHeight.tight,
  },
});
