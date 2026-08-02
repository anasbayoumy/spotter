import type { PropsWithChildren, ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

import { sharedStyles, theme } from "../theme";
import { Button } from "./Button";

interface NoticeProps extends PropsWithChildren {
  readonly actionLabel?: string;
  readonly live?: boolean;
  readonly onAction?: () => void;
  readonly title: string;
  readonly tone?: "attention" | "error" | "info" | "success";
}

export function Notice({
  actionLabel,
  children,
  live = false,
  onAction,
  title,
  tone = "info",
}: NoticeProps): ReactElement {
  return (
    <View
      accessibilityLiveRegion={live ? "polite" : "none"}
      accessibilityRole={tone === "error" ? "alert" : "summary"}
      style={[styles.container, styles[tone]]}
    >
      <Text style={styles.title}>{title}</Text>
      {children === undefined ? null : <Text style={sharedStyles.body}>{children}</Text>}
      {actionLabel === undefined || onAction === undefined ? null : (
        <Button label={actionLabel} onPress={onAction} style={styles.action} variant="secondary" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: "flex-start", marginTop: theme.spacing.md },
  attention: { borderLeftColor: theme.colors.attention },
  container: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderLeftWidth: 5,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
  },
  error: { borderLeftColor: theme.colors.blocked },
  info: { borderLeftColor: theme.colors.info },
  success: { borderLeftColor: theme.colors.clear },
  title: { color: theme.colors.ink, fontSize: theme.typography.size.lg, fontWeight: "600" },
});
