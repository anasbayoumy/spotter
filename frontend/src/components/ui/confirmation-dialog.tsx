"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "./button";

interface ConfirmationDialogProps {
  readonly busy: boolean;
  readonly children?: ReactNode;
  readonly confirmDisabled?: boolean;
  readonly confirmLabel: string;
  readonly description: string;
  readonly kind: "approve" | "override" | "reject";
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ConfirmationDialog({
  busy,
  children,
  confirmDisabled = false,
  confirmLabel,
  description,
  kind,
  onCancel,
  onConfirm,
  title,
}: ConfirmationDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const returnTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      returnTarget?.focus();
    };
  }, []);

  return (
    <div className="confirmation-backdrop">
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`confirmation-panel confirmation-panel--${kind}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = [
            ...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
          ];
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable.at(-1);
          if (first === undefined || last === undefined) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        ref={dialogRef}
        role="dialog"
      >
        <CircleAlert aria-hidden="true" size={19} />
        <div>
          <strong id={titleId}>{title}</strong>
          <p id={descriptionId}>{description}</p>
          {children}
          <div className="form-actions">
            <Button disabled={busy} onClick={onCancel} ref={cancelRef} variant="ghost">
              Cancel
            </Button>
            <Button
              busy={busy}
              disabled={confirmDisabled}
              onClick={onConfirm}
              variant={kind === "approve" ? "primary" : "danger"}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
