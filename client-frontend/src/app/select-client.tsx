import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ApiErrorNotice } from "../components/ApiErrorNotice";
import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { useClientSelection } from "../features/client-selector/SelectionProvider";
import { clientApi } from "../lib/api/client";
import { theme } from "../theme";

export default function SelectClientRoute(): ReactElement {
  const { clearSelection, clientId, selectClient } = useClientSelection();
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const clientsQuery = useQuery({
    queryFn: () => clientApi.listActiveClients(),
    queryKey: ["demo-clients", "active"],
  });

  useEffect(() => {
    if (
      clientsQuery.data !== undefined &&
      clientId !== null &&
      !clientsQuery.data.some((client) => client.id === clientId)
    ) {
      void clearSelection().catch((error: unknown) => {
        setSelectionError(error instanceof Error ? error.message : "Selection could not be reset.");
      });
    }
  }, [clearSelection, clientId, clientsQuery.data]);

  const choose = async (nextClientId: string): Promise<void> => {
    setSelectionError(null);
    try {
      await selectClient(nextClientId);
      router.replace("/today");
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selection could not be saved.");
    }
  };

  return (
    <Screen
      description="Pick a seeded synthetic profile to preview its client experience. This does not authenticate or grant access."
      title="Select demo client"
    >
      {selectionError === null ? null : (
        <Notice live title="Selection unavailable" tone="error">
          {selectionError}
        </Notice>
      )}
      {clientsQuery.isPending ? (
        <Notice live title="Loading synthetic clients">
          Only active demo profiles will appear.
        </Notice>
      ) : null}
      {clientsQuery.error === null ? null : (
        <ApiErrorNotice error={clientsQuery.error} onRetry={() => void clientsQuery.refetch()} />
      )}
      {clientsQuery.data?.length === 0 ? (
        <Notice title="No active demo clients">
          Seed the demo data, then retry. Paused, churned, and non-synthetic records are
          intentionally excluded.
        </Notice>
      ) : null}
      <View style={styles.list}>
        {clientsQuery.data?.map((client) => (
          <Pressable
            accessibilityHint="Opens Today for this synthetic client"
            accessibilityLabel={`Select ${client.handle}`}
            accessibilityRole="button"
            key={client.id}
            onPress={() => void choose(client.id)}
            style={({ pressed }) => [styles.client, pressed ? styles.pressed : null]}
          >
            <View style={styles.clientCopy}>
              <Text style={styles.handle}>{client.handle}</Text>
              <Text style={styles.goal} numberOfLines={2}>
                {client.goals.primary}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chevron: { color: theme.colors.brand, fontSize: theme.typography.size.xxl },
  client: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 72,
    padding: theme.spacing.lg,
  },
  clientCopy: { flex: 1, gap: theme.spacing.xs },
  goal: { color: theme.colors.inkMuted, fontSize: theme.typography.size.sm },
  handle: { color: theme.colors.ink, fontSize: theme.typography.size.lg, fontWeight: "700" },
  list: { gap: theme.spacing.md },
  pressed: { backgroundColor: theme.colors.canvasElevated },
});
