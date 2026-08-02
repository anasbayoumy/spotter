import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { ApiErrorNotice } from "../../components/ApiErrorNotice";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { Screen } from "../../components/Screen";
import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import {
  clearSessionDraft,
  createSessionDraft,
  readSessionDraft,
  saveSessionDraft,
  type SessionDraft,
  validateSessionSubmission,
} from "../../features/session-logging/draft";
import { clientApi } from "../../lib/api/client";
import { ApiClientError, isStaleConflict } from "../../lib/api/errors";
import { bindKeyToPayload } from "../../lib/api/idempotency";
import { queryClient } from "../../lib/query/client";
import { sharedStyles, theme } from "../../theme";

function firstParam(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

export default function SessionRoute(): ReactElement {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = firstParam(params.sessionId);
  const { clientId, loading: selectionLoading } = useClientSelection();
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Readonly<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const sessionQuery = useQuery({
    enabled: sessionId !== null,
    queryFn: () => {
      if (sessionId === null) throw new Error("Session ID is missing.");
      return clientApi.getSession(sessionId);
    },
    queryKey: ["session", sessionId],
  });

  useEffect(() => {
    if (sessionQuery.data === undefined || sessionId === null || draftReady) return;
    let active = true;
    void readSessionDraft(sessionId)
      .then((stored) => {
        if (active) setDraft(stored ?? createSessionDraft(sessionQuery.data));
      })
      .catch((error: unknown) => {
        if (active) {
          setStorageError(error instanceof Error ? error.message : "Draft could not be restored.");
          setDraft(createSessionDraft(sessionQuery.data));
        }
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [draftReady, sessionId, sessionQuery.data]);

  useEffect(() => {
    if (!draftReady || draft === null || sessionId === null) return;
    const timeout = setTimeout(() => {
      void saveSessionDraft(sessionId, draft).catch((error: unknown) => {
        setStorageError(error instanceof Error ? error.message : "Draft could not be saved.");
      });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [draft, draftReady, sessionId]);

  if (selectionLoading) {
    return (
      <Screen title="Log session">
        <Notice live title="Loading client selection" />
      </Screen>
    );
  }
  if (clientId === null) return <Redirect href="/select-client" />;
  const session = sessionQuery.data;
  const belongsToSelection = session === undefined || session.clientId === clientId;

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    patch: Readonly<Partial<SessionDraft["exercises"][number]["sets"][number]>>,
  ): void => {
    setDraft((current) => {
      if (current === null) return current;
      return {
        ...current,
        exercises: current.exercises.map((exercise, currentExerciseIndex) =>
          currentExerciseIndex === exerciseIndex
            ? {
                ...exercise,
                sets: exercise.sets.map((set, currentSetIndex) =>
                  currentSetIndex === setIndex ? { ...set, ...patch } : set,
                ),
              }
            : exercise,
        ),
      };
    });
  };

  const submit = async (): Promise<void> => {
    if (draft === null || sessionId === null) return;
    const stableDraft = {
      ...draft,
      performedAt: draft.performedAt ?? new Date().toISOString(),
    };
    setDraft(stableDraft);
    try {
      await saveSessionDraft(sessionId, stableDraft);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Draft could not be saved.");
      return;
    }
    const validation = validateSessionSubmission(clientId, stableDraft);
    if (!validation.success) {
      setValidationErrors(validation.errors);
      return;
    }
    setValidationErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const logKey = bindKeyToPayload(
        stableDraft.logKey,
        stableDraft.logPayloadFingerprint,
        "session-log",
        sessionId,
        validation.data.log,
      );
      let attemptedDraft = {
        ...stableDraft,
        logKey: logKey.key,
        logPayloadFingerprint: logKey.fingerprint,
      };
      setDraft(attemptedDraft);
      await saveSessionDraft(sessionId, attemptedDraft);
      const logged = await clientApi.logSession(sessionId, validation.data.log, logKey.key);
      const completionInput = {
        ...validation.data.completion,
        expectedVersion: logged.version,
      };
      const completeKey = bindKeyToPayload(
        attemptedDraft.completeKey,
        attemptedDraft.completePayloadFingerprint,
        "session-complete",
        sessionId,
        completionInput,
      );
      attemptedDraft = {
        ...attemptedDraft,
        completeKey: completeKey.key,
        completePayloadFingerprint: completeKey.fingerprint,
      };
      setDraft(attemptedDraft);
      await saveSessionDraft(sessionId, attemptedDraft);
      await clientApi.completeSession(sessionId, completionInput, completeKey.key);
      setCompleted(true);
      try {
        await clearSessionDraft(sessionId);
      } catch (error) {
        setStorageError(
          error instanceof Error ? error.message : "Completed draft could not be cleared.",
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["sessions", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["today", clientId] }),
      ]);
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      description="Record the work you performed against this approved session. Your draft stays on this device until success."
      title="Log session"
    >
      {sessionQuery.isPending ? <Notice live title="Loading approved session" /> : null}
      {sessionQuery.error === null ? null : (
        <ApiErrorNotice error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />
      )}
      {storageError === null ? null : (
        <Notice live title="Local draft warning" tone="attention">
          {storageError}
        </Notice>
      )}
      {!belongsToSelection ? (
        <Notice title="Session does not belong to this selection" tone="error">
          Choose the matching synthetic client. Client selection is not authorization.
        </Notice>
      ) : null}
      {completed || session?.status === "completed" ? (
        <Notice
          actionLabel="View History"
          live
          onAction={() => {
            router.replace("/history");
          }}
          title="Session completed"
          tone="success"
        >
          Your recorded work is saved and will appear in History. Any adjustment remains a coach
          proposal until approved.
        </Notice>
      ) : null}
      {submitError === null ? null : isStaleConflict(submitError) ? (
        <Notice live title="This published session changed" tone="attention">
          Your draft is preserved. Return to Today, refresh the current plan, and review it before
          trying again.
          {submitError instanceof ApiClientError && submitError.requestId !== null
            ? ` Request ID: ${submitError.requestId}`
            : ""}
        </Notice>
      ) : (
        <ApiErrorNotice error={submitError} onRetry={() => void submit()} />
      )}
      {Object.keys(validationErrors).length === 0 ? null : (
        <Notice live title="Check the session fields" tone="error">
          {Object.values(validationErrors).slice(0, 3).join(" ")}
        </Notice>
      )}
      {session === undefined ||
      draft === null ||
      !belongsToSelection ||
      completed ||
      session.status === "completed" ? null : (
        <>
          {session.planned.map((planned, exerciseIndex) => {
            const exerciseDraft = draft.exercises[exerciseIndex];
            if (exerciseDraft === undefined) return null;
            return (
              <Card
                eyebrow={`${String(planned.sets)} sets · planned RPE ${String(planned.rpe)}${planned.loadKg === undefined || planned.loadKg === null ? "" : ` · ${String(planned.loadKg)} kg prescribed`}`}
                key={planned.id}
                title={planned.name}
              >
                <Text style={sharedStyles.caption}>
                  Planned reps:{" "}
                  {typeof planned.reps === "number"
                    ? String(planned.reps)
                    : `${String(planned.reps.min)}–${String(planned.reps.max)}`}
                </Text>
                {planned.loadKg === undefined || planned.loadKg === null ? null : (
                  <Text style={sharedStyles.caption}>
                    Prescribed load: {String(planned.loadKg)} kg. Record the load actually used
                    below.
                  </Text>
                )}
                {exerciseDraft.sets.map((set, setIndex) => (
                  <View key={set.setIndex} style={styles.setCard}>
                    <View style={styles.setHeading}>
                      <Text style={styles.setTitle}>Set {String(set.setIndex)}</Text>
                      <View style={styles.switchRow}>
                        <Text style={sharedStyles.caption}>Completed</Text>
                        <Switch
                          accessibilityLabel={`${planned.name}, set ${String(set.setIndex)} completed`}
                          onValueChange={(completedValue) => {
                            updateSet(exerciseIndex, setIndex, { completed: completedValue });
                          }}
                          value={set.completed}
                        />
                      </View>
                    </View>
                    <View style={styles.fieldRow}>
                      <Field
                        keyboardType="number-pad"
                        label={`Set ${String(set.setIndex)} reps`}
                        onChangeText={(reps) => {
                          updateSet(exerciseIndex, setIndex, { reps });
                        }}
                        style={styles.compactField}
                        value={set.reps}
                      />
                      <Field
                        keyboardType="decimal-pad"
                        label={`Set ${String(set.setIndex)} load kg`}
                        onChangeText={(loadKg) => {
                          updateSet(exerciseIndex, setIndex, { loadKg });
                        }}
                        placeholder="Optional"
                        style={styles.compactField}
                        value={set.loadKg}
                      />
                      <Field
                        keyboardType="decimal-pad"
                        label={`Set ${String(set.setIndex)} RPE`}
                        onChangeText={(rpe) => {
                          updateSet(exerciseIndex, setIndex, { rpe });
                        }}
                        placeholder="1–10"
                        style={styles.compactField}
                        value={set.rpe}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            );
          })}
          <Field
            keyboardType="decimal-pad"
            label="Overall session RPE"
            onChangeText={(sessionRpe) => {
              setDraft((current) => (current === null ? current : { ...current, sessionRpe }));
            }}
            placeholder="1–10"
            value={draft.sessionRpe}
          />
          <Field
            label="Session notes (optional)"
            maxLength={4000}
            multiline
            onChangeText={(notes) => {
              setDraft((current) => (current === null ? current : { ...current, notes }));
            }}
            placeholder="What felt different today?"
            value={draft.notes}
          />
          <Button
            accessibilityHint="Saves structured work and completes this session idempotently"
            label="Save and complete session"
            loading={submitting}
            onPress={() => void submit()}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  compactField: { minWidth: 120 },
  fieldRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  setCard: {
    backgroundColor: theme.colors.canvas,
    borderRadius: theme.radius.md,
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  setHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  setTitle: { color: theme.colors.ink, fontSize: theme.typography.size.md, fontWeight: "600" },
  switchRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing.sm, minHeight: 48 },
});
