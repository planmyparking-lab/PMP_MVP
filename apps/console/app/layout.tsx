import type { ReactNode } from "react";
import { AppShell } from "../src/components/AppShell";
import { ToastProvider } from "../src/components/ui/Toast";
import "./globals.css";

export const metadata = {
  title: "PlanMyParking Console",
  description: "Operator console for parking facilities",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
