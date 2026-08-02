import type { Metadata } from "next";

import { ClientDetailPage } from "../../../features/client-detail/client-detail-page";

export const metadata: Metadata = { title: "Client detail" };

export default async function ClientPage({
  params,
}: {
  readonly params: Promise<{ readonly clientId: string }>;
}): Promise<React.JSX.Element> {
  const { clientId } = await params;
  return <ClientDetailPage clientId={clientId} />;
}
