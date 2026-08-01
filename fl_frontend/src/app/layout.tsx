import "./globals.css";

import { Inter } from "next/font/google";

import { RootProviders } from "@/core/providers/RootProviders";

import type { Metadata } from "next";

/** Fonts */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Metadata
 *
 * `metadataBase` is what lets every route below spell its canonical as a PATH. A route that declares
 * none inherits this file's, so an unset canonical points at the homepage rather than at nothing.
 *
 * `openGraph` deliberately carries no `title`, `description` or `url`. Next inherits the whole object
 * when a child defines none and replaces it whole when a child does — there is no field-by-field
 * merge — so anything page-specific named here is stamped onto every page in the app. Left out,
 * og:title and og:description resolve from each page's own `title`/`description`. Only genuinely
 * site-wide values belong in this block.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://frankfurtleague.de"),
  title: {
    template: "%s | Frankfurt-League",
    default: "Frankfurt-League | Die Oberstufenliga",
  },
  description:
    "Bei der Frankfurt-League treten Frankfurter Oberstufen gegeneinander an, um herauszufinden, welche von ihnen die Beste ist. Hier gibt's alle Infos.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    siteName: "Frankfurt-League",
    images: [
      {
        url: "/icons/opengraph/opengraph.png",
        width: 1200,
        height: 630,
        alt: "FL-Preview",
      },
    ],
    locale: "de_DE",
    type: "website",
  },
  // Without this X falls back to a small square thumbnail. Title, description and image are inherited
  // from `openGraph`, so the card only has to declare its shape.
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
      <body className="bg-background text-foreground font-primary text-fluid-base relative flex min-h-dvh w-full flex-col antialiased">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
