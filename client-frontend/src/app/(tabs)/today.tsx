import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { ApiErrorNotice } from "../../components/ApiErrorNotice";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Notice } from "../../components/Notice";
import { Screen } from "../../components/Screen";
import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import { deriveTodayState } from "../../features/today/view-model";
import { clientApi } from "../../lib/api/client";
import { ApiClientError } from "../../lib/api/errors";
import { formatCalendarDate } from "../../lib/dates";
import { sharedStyles, theme } from "../../theme";

export default function TodayRoute(): ReactElement {
  const { clearSelection, clientId } = useClientSelection();
  const [selectionResetError, setSelectionResetError] = useState<string | null>(null);
  const todayQuery = useQuery({
    enabled: clientId !== null,
    queryFn: () => {
      if (clientId === null) throw new Error("A demo client must be selected.");
      return clientApi.getToday(clientId);
    },
    queryKey: ["today", clientId],
  });

  useEffect(() => {
    if (
      todayQuery.error instanceof ApiClientError &&
      ["client_not_found", "not_found"].includes(todayQuery.error.code)
    ) {
      void clearSelection()
        .then(() => {
          router.replace("/select-client");
        })
        .catch((error: unknown) => {
          setSelectionResetError(
            error instanceof Error
              ? error.message
              : "The invalid local selection could not be reset.",
          );
        });
    }
  }, [clearSelection, todayQuery.error]);

  const changeClient = (): void => {
    router.push("/select-client");
  };
  const state = todayQuery.data === undefined ? null : deriveTodayState(todayQuery.data);
  return (
    <Screen
      actions={<Button label="Change client" onPress={changeClient} variant="text" />}
      description="Only the current coach-published plan is shown here."
      title="Today"
    >
      {todayQuery.isPending ? (
        <Notice live title="Loading today's approved plan">
          Checking the selected client's local date and current publication.
        </Notice>
      ) : null}
      {selectionResetError === null ? null : (
        <Notice live title="Selection reset failed" tone="error">
          {selectionResetError}
        </Notice>
      )}
      {todayQuery.error === null ? null : (
        <ApiErrorNotice error={todayQuery.error} onRetry={() => void todayQuery.refetch()} />
      )}
      {todayQuery.data?.outstandingMessage === null ||
      todayQuery.data?.outstandingMessage === undefined ? null : (
        <Card eyebrow="Coach message" title="A note for you">
          <Text style={sharedStyles.body}>{todayQuery.data.outstandingMessage.body}</Text>
        </Card>
      )}
      {state?.kind === "no-programme" ? (
        <Notice title="No published plan yet">
          Your coach has not published a current plan. Drafts and proposals stay private until
          approval.
        </Notice>
      ) : null}
      {state?.kind === "rest-day" ? (
        <Notice title="Rest day" tone="success">
          {state.nextSession === null
            ? "There is no upcoming approved session yet."
            : `Next session: ${formatCalendarDate(state.nextSession.scheduledFor)}.`}
        </Notice>
      ) : null}
      {state?.kind === "already-completed" ? (
        <Notice title="Session completed" tone="success">
          This approved session is recorded in History.
        </Notice>
      ) : null}
      {state?.kind === "due" ? (
        <Card
          eyebrow={formatCalendarDate(state.session.scheduledFor)}
          footer={
            <Button
              label="Open session log"
              onPress={() => {
                router.push({
                  params: { sessionId: state.session.id },
                  pathname: "/session/[sessionId]",
                });
              }}
              style={styles.cardButton}
            />
          }
          title={state.session.planned.map((exercise) => exercise.name).join(" · ")}
        >
          <Text style={[sharedStyles.body, styles.muted]}>
            {String(state.session.planned.length)} planned exercises from the current published
            plan.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardButton: { marginTop: theme.spacing.lg },
  muted: { color: theme.colors.inkMuted },
});
