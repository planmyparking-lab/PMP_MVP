import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import { AppShell } from "../src/components/AppShell";
import { NoAccess } from "../src/components/NoAccess";
import { ToastProvider } from "../src/components/ui/Toast";
import { getConsoleSession } from "../src/lib/data/session";
import "./globals.css";
import "./brand.css";

// Self-hosted at build time by next/font; no request to Google from the browser.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata = {
  title: "PlanMyParking Console",
  description: "Operator console for parking facilities",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getConsoleSession();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <ToastProvider>
          <AppShell session={session}>
            {session.kind === "denied" ? <NoAccess session={session} /> : children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
