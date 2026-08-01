import { AlertCircle, CloudOff, Inbox, RotateCw } from "lucide-react";
import React, { type ReactNode } from "react";

import type { ApiClientError } from "../../lib/api/client";
import { Button } from "./button";

export function LoadingState({
  label = "Loading coach workspace",
}: {
  readonly label?: string;
}): React.JSX.Element {
  return (
    <div
      aria-live="polite"
      aria-label={label}
      className="state-panel state-panel--loading"
      role="status"
    >
      <span aria-hidden="true" className="loading-mark" />
      <div>
        <strong>{label}</strong>
        <p>Checking the latest recorded state.</p>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  readonly error: ApiClientError;
  readonly onRetry?: () => void;
  readonly title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps): React.JSX.Element {
  const offline = error.code === "network_error";
  const Icon = offline ? CloudOff : AlertCircle;
  return (
    <div aria-live="assertive" className="state-panel state-panel--error" role="alert">
      <Icon aria-hidden="true" size={24} />
      <div className="state-panel__content">
        <strong>
          {title ?? (offline ? "Spotter is offline" : "This view could not be loaded")}
        </strong>
        <p>{error.message}</p>
        {error.requestId === null ? null : (
          <p className="request-id">
            Request ID <code>{error.requestId}</code>
          </p>
        )}
        {onRetry === undefined ? null : (
          <Button onClick={onRetry} variant="secondary">
            <RotateCw aria-hidden="true" size={15} /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  readonly action?: ReactNode;
  readonly body: string;
  readonly title: string;
}

export function EmptyState({ action, body, title }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="state-panel state-panel--empty">
      <Inbox aria-hidden="true" size={24} />
      <div className="state-panel__content">
        <strong>{title}</strong>
        <p>{body}</p>
        {action}
      </div>
    </div>
  );
}

export function InlineStatus({
  children,
  tone = "info",
}: {
  readonly children: ReactNode;
  readonly tone?: "danger" | "info" | "success" | "warning";
}): React.JSX.Element {
  return (
    <div aria-live="polite" className={`inline-status inline-status--${tone}`} role="status">
      {children}
    </div>
  );
}
