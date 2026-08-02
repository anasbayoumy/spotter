"use client";

import { ApiClientError } from "../lib/api/client";
import { ErrorState } from "../components/ui/states";

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): React.JSX.Element {
  const safeError = new ApiClientError(
    "internal_error",
    "The coach workspace encountered an unexpected rendering failure.",
    error.digest ?? null,
    true,
    null,
  );
  return <ErrorState error={safeError} onRetry={reset} title="Coach workspace interrupted" />;
}
