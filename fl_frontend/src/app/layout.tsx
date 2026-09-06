import "./globals.css";

import { Anton, Inter, Raleway } from "next/font/google";

import { SITE_URL } from "@/core/brand";
import { RootProviders } from "@/core/providers/RootProviders";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
});

// No `weight`, so the whole variable axis loads: pinning one would leave every other weight the
// tree spells to the browser to fake, with nothing reporting it. The italic is loaded rather
// than faked: `fl_frontend/src/app/globals.css` turns font synthesis off.
const raleway = Raleway({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-raleway",
});

// Loaded for the numerals: `--font-numeric` resolves here, so the columned readouts keep tabular
// figures whatever face the headings and the body take.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // The public league table sets its figures in this face, so it is preloaded like the other two:
  // a swap on that page would reflow every column.
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
    template: "%s | Frankfurt League",
    default: "Frankfurt League | Die Oberstufenliga",
  },
  description:
    "Bei der Frankfurt League treten Frankfurter Oberstufen gegeneinander an, um herauszufinden, welche von ihnen die Beste ist. Hier gibt's alle Infos.",
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
      className={`${anton.variable} ${raleway.variable} ${inter.variable} scrollbar-gutter-stable`}>
      {/* No containing-block trigger on either root (`docs/frontend/spec.md :: I29`): one would make
          the page the containing block for every portalled overlay. */}
      <body className="bg-background text-foreground font-primary fluid-base flex min-h-dvh w-full flex-col antialiased">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
