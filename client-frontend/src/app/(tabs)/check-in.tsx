import { useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ApiErrorNotice } from "../../components/ApiErrorNotice";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Notice } from "../../components/Notice";
import { Screen } from "../../components/Screen";
import {
  clearCheckInDraft,
  createCheckInDraft,
  readCheckInDraft,
  saveCheckInDraft,
  type CheckInDraft,
  validateCheckInDraft,
} from "../../features/check-in/draft";
import { useClientSelection } from "../../features/client-selector/SelectionProvider";
import { clientApi } from "../../lib/api/client";
import { theme } from "../../theme";

export default function CheckInRoute(): ReactElement {
  const { clientId } = useClientSelection();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CheckInDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ readonly humanReview: boolean } | null>(null);

  useEffect(() => {
    if (clientId === null) return;
    let active = true;
    setDraftReady(false);
    void readCheckInDraft(clientId)
      .then((stored) => {
        if (active) setDraft(stored ?? createCheckInDraft(clientId));
      })
      .catch((error: unknown) => {
        if (active) {
          setStorageError(error instanceof Error ? error.message : "Draft could not be restored.");
          setDraft(createCheckInDraft(clientId));
        }
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!draftReady || clientId === null || draft === null) return;
    const timeout = setTimeout(() => {
      void saveCheckInDraft(clientId, draft).catch((error: unknown) => {
        setStorageError(error instanceof Error ? error.message : "Draft could not be saved.");
      });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [clientId, draft, draftReady]);

  if (clientId === null) return <Redirect href="/select-client" />;

  const submit = async (): Promise<void> => {
    if (draft === null) return;
    const stableDraft = {
      ...draft,
      respondedAt: draft.respondedAt ?? new Date().toISOString(),
    };
    setDraft(stableDraft);
    try {
      await saveCheckInDraft(clientId, stableDraft);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Draft could not be saved.");
      return;
    }
    const validation = validateCheckInDraft(clientId, stableDraft);
    if (!validation.success) {
      setValidationError(
        validation.error.issues[0]?.message ?? "Check the readiness and response.",
      );
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await clientApi.checkIn(validation.data, stableDraft.idempotencyKey);
      setSuccess({ humanReview: response.requiresHumanEscalation });
      setDraft(createCheckInDraft(clientId));
      try {
        await clearCheckInDraft(clientId);
      } catch (error) {
        setStorageError(
          error instanceof Error ? error.message : "Submitted draft could not be cleared.",
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["today", clientId] });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

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
      description="Share how ready you feel. Your coach may review this; it does not automatically change your plan."
      title="Check-in"
    >
      {storageError === null ? null : (
        <Notice live title="Local draft warning" tone="attention">
          {storageError}
        </Notice>
      )}
      {success === null ? null : success.humanReview ? (
        <Notice live title="Sent for human review" tone="attention">
          A coach will review your response. Spotter does not diagnose symptoms or provide medical
          advice. If you may be in immediate danger, contact local emergency services.
        </Notice>
      ) : (
        <Notice live title="Check-in received" tone="success">
          Your response is saved. Your coach may review it before any plan change is proposed.
        </Notice>
      )}
      {submitError === null ? null : (
        <ApiErrorNotice error={submitError} onRetry={() => void submit()} />
      )}
      {validationError === null ? null : (
        <Notice live title="Check your response" tone="error">
          {validationError}
        </Notice>
      )}
      {draft === null ? (
        <Notice live title="Loading saved check-in draft" />
      ) : (
        <>
          <Text style={styles.label}>Readiness, 1 to 5</Text>
          <View accessibilityRole="radiogroup" style={styles.readinessRow}>
            {[1, 2, 3, 4, 5].map((readiness) => {
              const selected = draft.readiness === readiness;
              return (
                <Pressable
                  accessibilityLabel={`Readiness ${String(readiness)} of 5`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={readiness}
                  onPress={() => {
                    setSuccess(null);
                    setDraft((current) => (current === null ? current : { ...current, readiness }));
                  }}
                  style={[styles.readiness, selected ? styles.readinessSelected : null]}
                >
                  <Text
                    style={[styles.readinessText, selected ? styles.readinessTextSelected : null]}
                  >
                    {String(readiness)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Field
            label="How are you feeling?"
            maxLength={4000}
            multiline
            onChangeText={(body) => {
              setSuccess(null);
              setDraft((current) => (current === null ? current : { ...current, body }));
            }}
            placeholder="Share readiness, recovery, or concerns in your own words."
            value={draft.body}
          />
          <Text style={styles.counter}>{String(draft.body.length)} / 4000</Text>
          <Notice title="Safety note">
            Urgent symptoms or safety concerns are routed for human review. This app will not
            diagnose or recommend treatment.
          </Notice>
          <Button label="Send check-in" loading={submitting} onPress={() => void submit()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  counter: {
    color: theme.colors.inkMuted,
    fontSize: theme.typography.size.sm,
    marginBottom: theme.spacing.lg,
    marginTop: -theme.spacing.md,
    textAlign: "right",
  },
  label: { color: theme.colors.ink, fontSize: theme.typography.size.sm, fontWeight: "600" },
  readiness: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 52,
  },
  readinessRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    marginTop: theme.spacing.sm,
  },
  readinessSelected: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  readinessText: { color: theme.colors.ink, fontSize: theme.typography.size.lg, fontWeight: "700" },
  readinessTextSelected: { color: theme.colors.onStrong },
});
