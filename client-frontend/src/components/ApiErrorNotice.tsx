import type { ReactElement } from "react";
import { Text } from "react-native";

import { toApiClientError } from "../lib/api/errors";
import { sharedStyles } from "../theme";
import { Notice } from "./Notice";

interface ApiErrorNoticeProps {
  readonly error: unknown;
  readonly onRetry?: () => void;
}

export function ApiErrorNotice({ error, onRetry }: ApiErrorNoticeProps): ReactElement {
  const apiError = toApiClientError(error);
  const retryProps =
    apiError.retryable && onRetry !== undefined ? { actionLabel: "Retry", onAction: onRetry } : {};
  return (
    <Notice
      {...retryProps}
      live
      title={apiError.kind === "network" ? "You appear to be offline" : "We couldn't load this"}
      tone="error"
    >
      {apiError.message}
      {apiError.requestId === null ? null : (
        <Text style={sharedStyles.caption}> Request ID: {apiError.requestId}</Text>
      )}
    </Notice>
  );
}
