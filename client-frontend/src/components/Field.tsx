import type { ComponentProps, ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { sharedStyles, theme } from "../theme";

interface FieldProps extends Omit<ComponentProps<typeof TextInput>, "accessibilityLabel"> {
  readonly error?: string;
  readonly label: string;
}

export function Field({ error, label, style, ...inputProps }: FieldProps): ReactElement {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityHint={error}
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.inkMuted}
        style={[styles.input, inputProps.multiline ? styles.multiline : null, style]}
      />
      {error === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={[sharedStyles.caption, styles.error]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  error: { color: theme.colors.blocked },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.ink,
    fontSize: theme.typography.size.md,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  label: { color: theme.colors.ink, fontSize: theme.typography.size.sm, fontWeight: "600" },
  multiline: { minHeight: 112, textAlignVertical: "top" },
});
