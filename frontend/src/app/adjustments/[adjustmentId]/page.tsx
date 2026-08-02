import type { Metadata } from "next";

import { AdjustmentReviewPage } from "../../../features/adjustment-review/adjustment-review-page";

export const metadata: Metadata = { title: "Adjustment review" };

export default async function AdjustmentPage({
  params,
}: {
  readonly params: Promise<{ readonly adjustmentId: string }>;
}): Promise<React.JSX.Element> {
  const { adjustmentId } = await params;
  return <AdjustmentReviewPage adjustmentId={adjustmentId} />;
}
