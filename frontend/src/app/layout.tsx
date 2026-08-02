import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { CoachShell } from "../components/layout/coach-shell";
import { QueryProvider } from "../components/layout/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  description: "Human-supervised programme review for seeded synthetic coaching scenarios.",
  title: { default: "Spotter Coach", template: "%s · Spotter Coach" },
};

export const viewport: Viewport = { colorScheme: "light", themeColor: "#0D4C35" };

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryProvider>
          <CoachShell>{children}</CoachShell>
        </QueryProvider>
      </body>
    </html>
  );
}
