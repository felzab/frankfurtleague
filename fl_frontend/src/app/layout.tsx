import "./globals.css";

import { Inter } from "next/font/google";

import { SITE_URL } from "@/core/brand";
import { RootProviders } from "@/core/providers/RootProviders";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * `metadataBase` lets every route spell its canonical as a PATH, and one declaring none inherits
 * this file's. Next replaces `openGraph` WHOLE rather than merging, which is why every route
 * builds one through `openGraphFor(path)`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "%s | Frankfurt-League",
    default: "Frankfurt-League | Die Oberstufenliga",
  },
  description:
    "Bei der Frankfurt-League treten Frankfurter Oberstufen gegeneinander an, um herauszufinden, welche von ihnen die Beste ist. Hier gibt's alle Infos.",
  alternates: {
    canonical: "/",
  },
  openGraph: openGraphFor("/"),
  // Without this X falls back to a small square thumbnail; the rest is inherited.
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${inter.variable} scrollbar-gutter-stable`}>
      {/* No containing-block trigger on either root (`docs/frontend/spec.md :: I29`): one would make
          the page the containing block for every portalled overlay. */}
      <body className="bg-background text-foreground font-primary fluid-base flex min-h-dvh w-full flex-col antialiased">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
