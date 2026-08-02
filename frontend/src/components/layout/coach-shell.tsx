import { FlaskConical } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { NavigationLink } from "./navigation-link";

const baselineClientId = "00000000-0000-4000-8000-000000000101";

export function CoachShell({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <div className="coach-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link aria-label="Spotter coach queue" className="brand" href="/queue">
          <span aria-hidden="true" className="brand__mark">
            S
          </span>
          <span>
            <strong>Spotter</strong>
            <small>Coach console</small>
          </span>
        </Link>
        <div className="demo-badge">
          <FlaskConical aria-hidden="true" size={14} />
          Demo mode · synthetic data
        </div>
        <nav aria-label="Coach workspace" className="primary-nav">
          <NavigationLink href="/queue" icon="queue" label="Review queue" />
          <NavigationLink
            href={`/clients/${baselineClientId}`}
            icon="client"
            label="Client c_001"
          />
          <NavigationLink href="/scorecard" icon="scorecard" label="Scorecard" />
        </nav>
        <div className="sidebar__note">
          <span className="presence-dot" /> Recorded model mode is designed for deterministic
          review.
        </div>
      </aside>
      <div className="coach-shell__body">
        <header className="mobile-header">
          <Link className="brand brand--mobile" href="/queue">
            <span aria-hidden="true" className="brand__mark">
              S
            </span>
            <strong>Spotter</strong>
          </Link>
          <span className="demo-badge demo-badge--compact">Demo · synthetic</span>
        </header>
        <nav aria-label="Coach workspace mobile" className="mobile-nav">
          <NavigationLink href="/queue" icon="queue" label="Queue" />
          <NavigationLink href={`/clients/${baselineClientId}`} icon="client" label="Client" />
          <NavigationLink href="/scorecard" icon="scorecard" label="Scorecard" />
        </nav>
        <main className="page-container" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
