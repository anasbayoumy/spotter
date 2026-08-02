import type { ReactElement } from "react";
import { useState } from "react";
import type { GestureResponderEvent, StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { theme } from "../theme";

interface ButtonProps {
  readonly accessibilityHint?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly loading?: boolean;
  readonly onPress: (event: GestureResponderEvent) => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly variant?: "primary" | "secondary" | "text";
}

export function Button({
  accessibilityHint,
  disabled = false,
  label,
  loading = false,
  onPress,
  style,
  variant = "primary",
}: ButtonProps): ReactElement {
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={loading ? `${label}, in progress` : label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !unavailable ? styles.pressed : null,
        focused ? styles.focused : null,
        unavailable ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? theme.colors.onStrong : theme.colors.brand}
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  disabled: { opacity: 0.5 },
  focused: { borderColor: theme.colors.focus, borderWidth: 3, paddingHorizontal: 14 },
  label: { fontSize: theme.typography.size.md, fontWeight: "600", textAlign: "center" },
  pressed: { opacity: 0.78 },
  primary: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  primaryLabel: { color: theme.colors.onStrong },
  secondary: { backgroundColor: theme.colors.surface, borderColor: theme.colors.brand },
  secondaryLabel: { color: theme.colors.brandStrong },
  text: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    paddingHorizontal: theme.spacing.sm,
  },
  textLabel: { color: theme.colors.brandStrong },
});
