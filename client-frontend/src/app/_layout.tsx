import "react-native-gesture-handler";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SelectionProvider } from "../features/client-selector/SelectionProvider";
import { queryClient } from "../lib/query/client";
import { theme } from "../theme";

export default function RootLayout(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SelectionProvider>
          <Head>
            <title>Spotter Client</title>
          </Head>
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
            <Stack.Screen
              name="session/[sessionId]"
              options={{ headerShown: Platform.OS !== "web", title: "Log session" }}
            />
          </Stack>
        </SelectionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
