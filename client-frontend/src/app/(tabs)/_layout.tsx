import { Redirect, Tabs } from "expo-router";
import type { ReactElement } from "react";

import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import { theme } from "../../theme";

export default function TabsLayout(): ReactElement {
  const { clientId, loading } = useClientSelection();
  if (!loading && clientId === null) return <Redirect href="/select-client" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.inkMuted,
        tabBarItemStyle: { minHeight: 48 },
        tabBarLabelStyle: { fontSize: theme.typography.size.sm, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.line,
          minHeight: 64,
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ tabBarAccessibilityLabel: "Today tab", title: "Today" }}
      />
      <Tabs.Screen
        name="history"
        options={{ tabBarAccessibilityLabel: "History tab", title: "History" }}
      />
      <Tabs.Screen
        name="check-in"
        options={{ tabBarAccessibilityLabel: "Check-in tab", title: "Check-in" }}
      />
    </Tabs>
  );
}
