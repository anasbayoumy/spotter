import type { ReviewBand } from "@spotter/contracts";
import { AlertTriangle, Check, OctagonAlert } from "lucide-react";

const labels = {
  attention: "Needs attention",
  blocked: "Blocked",
  clear: "Clear",
} as const satisfies Readonly<Record<ReviewBand, string>>;

export function BandBadge({ band }: { readonly band: ReviewBand }): React.JSX.Element {
  const Icon = band === "blocked" ? OctagonAlert : band === "attention" ? AlertTriangle : Check;
  return (
    <span className={`band-badge band-badge--${band}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.5} />
      {labels[band]}
    </span>
  );
}
