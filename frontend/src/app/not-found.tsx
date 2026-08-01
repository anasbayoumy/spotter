import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="not-found">
      <p className="eyebrow">Not found</p>
      <h1>This synthetic record is unavailable</h1>
      <p className="muted">
        It may have been removed, or the identifier may not belong to this demo workspace.
      </p>
      <Link className="button button--secondary" href="/queue">
        <ArrowLeft aria-hidden="true" size={16} /> Return to review queue
      </Link>
    </div>
  );
}
