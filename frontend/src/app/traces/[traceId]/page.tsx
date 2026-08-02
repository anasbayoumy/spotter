import type { Metadata } from "next";

import { TraceInspectorPage } from "../../../features/trace-inspector/trace-inspector-page";

export const metadata: Metadata = { title: "Context trace" };

export default async function TracePage({
  params,
}: {
  readonly params: Promise<{ readonly traceId: string }>;
}): Promise<React.JSX.Element> {
  const { traceId } = await params;
  return <TraceInspectorPage traceId={traceId} />;
}
