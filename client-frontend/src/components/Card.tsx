import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "../theme";

interface CardProps extends PropsWithChildren {
  readonly eyebrow?: string;
  readonly footer?: ReactNode;
  readonly title: string;
}

export function Card({ children, eyebrow, footer, title }: CardProps): ReactElement {
  return (
    <View style={styles.card}>
      {eyebrow === undefined ? null : <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.content}>{children}</View>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
  },
  content: { gap: theme.spacing.sm, marginTop: theme.spacing.md },
  eyebrow: {
    color: theme.colors.brand,
    fontSize: theme.typography.size.xs,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: theme.spacing.xs,
    textTransform: "uppercase",
  },
  title: { color: theme.colors.ink, fontSize: theme.typography.size.lg, fontWeight: "600" },
});
