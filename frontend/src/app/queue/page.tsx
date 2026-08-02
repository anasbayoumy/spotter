import type { Metadata } from "next";

import { ReviewQueuePage } from "../../features/review-queue/review-queue-page";

export const metadata: Metadata = { title: "Review queue" };

export default function QueuePage(): React.JSX.Element {
  return <ReviewQueuePage />;
}
