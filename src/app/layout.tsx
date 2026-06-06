/* Root layout — wraps all pages in the i18n provider.
   Imports global styles (DS tokens + base + components). */

import type { Metadata } from "next";
import "@/app/globals.css";
import "@/app/app.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "yummy or not",
  description: "Log your food verdicts",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
