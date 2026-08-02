import type { Metadata } from "next";

import { ProgrammeReviewPage } from "../../../features/programme-review/programme-review-page";

export const metadata: Metadata = { title: "Programme review" };

export default async function ProgrammePage({
  params,
}: {
  readonly params: Promise<{ readonly programmeId: string }>;
}): Promise<React.JSX.Element> {
  const { programmeId } = await params;
  return <ProgrammeReviewPage programmeId={programmeId} />;
}
