import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SelectionProvider } from "../features/client-selector/SelectionProvider";
import { queryClient } from "../lib/query/client";
import { theme } from "../theme";

export default function RootLayout(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SelectionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: theme.colors.canvas },
              headerShadowVisible: false,
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.brandStrong,
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="select-client" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session/[sessionId]" options={{ title: "Log session" }} />
          </Stack>
        </SelectionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
