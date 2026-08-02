import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { Text } from "react-native";

import { ApiErrorNotice } from "../../components/ApiErrorNotice";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Notice } from "../../components/Notice";
import { Screen } from "../../components/Screen";
import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import { selectHistorySessions } from "../../features/history/view-model";
import { clientApi } from "../../lib/api/client";
import { formatCalendarDate } from "../../lib/dates";
import { sharedStyles } from "../../theme";

export default function HistoryRoute(): ReactElement {
  const { clientId } = useClientSelection();
  const sessionsQuery = useQuery({
    enabled: clientId !== null,
    queryFn: () => {
      if (clientId === null) throw new Error("A demo client must be selected.");
      return clientApi.listSessions(clientId);
    },
    queryKey: ["sessions", clientId],
  });
  const history = selectHistorySessions(sessionsQuery.data ?? []);
  return (
    <Screen
      actions={
        <Button
          label="Change client"
          onPress={() => {
            router.push("/select-client");
          }}
          variant="text"
        />
      }
      description="Completed and missed due sessions, newest first. Future sessions are never marked missed."
      title="History"
    >
      {sessionsQuery.isPending ? <Notice live title="Loading session history" /> : null}
      {sessionsQuery.error === null ? null : (
        <ApiErrorNotice error={sessionsQuery.error} onRetry={() => void sessionsQuery.refetch()} />
      )}
      {!sessionsQuery.isPending && sessionsQuery.error === null && history.length === 0 ? (
        <Notice title="No completed or missed sessions yet">
          Completed sessions will appear here after they are recorded.
        </Notice>
      ) : null}
      {history.map((session) => (
        <Card
          eyebrow={`${formatCalendarDate(session.scheduledFor)} · ${session.status}`}
          key={session.id}
          title={session.planned.map((exercise) => exercise.name).join(" · ")}
        >
          <Text style={sharedStyles.body}>
            {session.status === "completed"
              ? `Completed${session.rpe === null ? "" : ` · Session RPE ${String(session.rpe)}`}`
              : "Missed after its due date"}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
