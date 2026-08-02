import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { sharedStyles, theme } from "../theme";

interface ScreenProps extends PropsWithChildren {
  readonly actions?: ReactNode;
  readonly description?: string;
  readonly scroll?: boolean;
  readonly title: string;
}

export function Screen({
  actions,
  children,
  description,
  scroll = true,
  title,
}: ScreenProps): ReactElement {
  const { width } = useWindowDimensions();
  const horizontal = width < 480 ? theme.spacing.lg : theme.spacing.xl;
  const content = (
    <View style={[styles.container, { paddingHorizontal: horizontal }]}>
      <View style={styles.demoBanner} accessibilityRole="summary">
        <Text style={styles.demoBannerText}>Synthetic demo · Client selector is not sign-in</Text>
      </View>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={sharedStyles.heading}>
            {title}
          </Text>
          {description === undefined ? null : (
            <Text style={[sharedStyles.body, styles.description]}>{description}</Text>
          )}
        </View>
        {actions}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={sharedStyles.screen}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "center",
    maxWidth: 760,
    paddingBottom: theme.spacing.xxxl,
    paddingTop: theme.spacing.sm,
    width: "100%",
  },
  demoBanner: {
    alignSelf: "stretch",
    backgroundColor: theme.colors.canvasElevated,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    marginBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    width: "100%",
  },
  demoBannerText: {
    color: theme.colors.inkMuted,
    fontSize: theme.typography.size.xs,
    fontWeight: "600",
  },
  description: { color: theme.colors.inkMuted, marginTop: theme.spacing.sm },
  headingCopy: { flex: 1 },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  scrollContent: { flexGrow: 1 },
});
