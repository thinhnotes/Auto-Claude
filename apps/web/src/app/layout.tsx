import type { Metadata } from "next";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";
import { I18nProvider } from "@/providers/I18nProvider";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Auto Claude",
  description: "AI-powered software development platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        <I18nProvider>
          <ConvexClientProvider initialToken={null}>
            {children}
          </ConvexClientProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
