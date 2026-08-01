import type { Metadata } from "next";

import { ScorecardPage } from "../../features/scorecard/scorecard-page";

export const metadata: Metadata = { title: "Evaluation scorecard" };

export default function ScorecardRoute(): React.JSX.Element {
  return <ScorecardPage />;
}
