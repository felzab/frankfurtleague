import "./globals.css";

import { Inter } from "next/font/google";

import { RootProviders } from "@/core/providers/RootProviders";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

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
 * `openGraph` comes from `openGraphFor(path)`, and every route calls it with its own path. Next
 * inherits the whole object when a child defines none and replaces it whole when a child does — there
 * is no field-by-field merge — so a route cannot add `url` without restating the rest, which is what
 * the helper exists to prevent. `title` and `description` stay out of it deliberately: left unset they
 * resolve from each page's own, which is what a social card should say.
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
  openGraph: openGraphFor("/"),
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
      {/* `<body>` stays unpositioned: a positioned root becomes the containing block for every
          portalled overlay, and react-aria then measures its `bottom` against the viewport, not the
          page (`docs/frontend/spec.md :: I29`). */}
      <body className="bg-background text-foreground font-primary fluid-base flex min-h-dvh w-full flex-col antialiased">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
