import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import type { ReactElement } from "react";
import type { ColorValue } from "react-native";

import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import { theme } from "../../theme";

const tabIcons = {
  "check-in": { active: "pulse", inactive: "pulse-outline" },
  history: { active: "time", inactive: "time-outline" },
  today: { active: "calendar", inactive: "calendar-outline" },
} as const;

interface TabBarIconProps {
  readonly color: ColorValue;
  readonly focused: boolean;
  readonly route: keyof typeof tabIcons;
  readonly size: number;
}

export function TabBarIcon({ color, focused, route, size }: TabBarIconProps): ReactElement {
  const icon = tabIcons[route];
  return (
    <Ionicons
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no-hide-descendants"
      name={focused ? icon.active : icon.inactive}
      size={Math.min(size, 24)}
    />
  );
}

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
        options={{
          tabBarAccessibilityLabel: "Today tab",
          tabBarIcon: (props) => <TabBarIcon {...props} route="today" />,
          title: "Today",
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarAccessibilityLabel: "History tab",
          tabBarIcon: (props) => <TabBarIcon {...props} route="history" />,
          title: "History",
        }}
      />
      <Tabs.Screen
        name="check-in"
        options={{
          tabBarAccessibilityLabel: "Check-in tab",
          tabBarIcon: (props) => <TabBarIcon {...props} route="check-in" />,
          title: "Check-in",
        }}
      />
    </Tabs>
  );
}
