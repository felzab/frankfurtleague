import "./globals.css";

import { Anton, Inter, Raleway } from "next/font/google";

import { BrandSprite } from "@/kit/BrandSprite";
import { RootProviders } from "@/kit/RootProviders";
import { ThemeColor } from "@/kit/ThemeColor";
import { WholePages } from "@/kit/WholePage";

import { SITE_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { SITE_OPEN_GRAPH } from "@/shared/utils/metadata";

import shareImage from "./share-image.png";

import type { Metadata, Viewport } from "next";

// Every face is `optional`, whose specification leaves out for that view a face not in within the browser's short
// block period, so no text is drawn in a stand-in and then again in the face, a redraw that moves the league table's
// and the search's figures. Measured in headless Chromium on a slow first visit, a late face is still swapped in at the
// load event, about 2 s after the first paint, with a layout shift of at most 0.0006. Anton's stand-in is the global styles' own face, fitted to the capitals Anton sets:
// the automatic one fits lowercase.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "optional",
  variable: "--font-anton",
  adjustFontFallback: false,
  fallback: ["Anton Fallback"],
});

// No `weight`, so the whole variable axis loads: pinning one would leave every other weight the
// tree spells to the browser to fake, with nothing reporting it. No italic either: with font
// synthesis off in the global styles, an `italic` sets upright.
const raleway = Raleway({
  subsets: ["latin"],
  display: "optional",
  variable: "--font-raleway",
});

// Loaded for the numerals: `--font-numeric` resolves here, so the columned readouts keep tabular
// figures whatever face the headings and the body take.
const inter = Inter({
  subsets: ["latin"],
  display: "optional",
  // The public league table sets its figures in this face, so it is preloaded like the other two.
  variable: "--font-inter",
});

/**
 * What every page inherits, so nothing here names one page: a description, a canonical or an og:url set
 * here would stand on every page declaring none, a signed-in one or one a mail opens among them. Each page
 * names its own title part, its description and its address through `pageMetadata`; `metadataBase` lets it spell
 * them as a path.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: `%s | ${COPY.brand.name}`,
    // Next requires it beside a template; a page naming no title of its own shows the league's name alone.
    default: COPY.brand.name,
  },
  // The share image as a static import: its address under `/_next/static/media/` carries a hash of the file's own
  // bytes, so a redrawn image is a new URL a preview fetches anew. A generated `opengraph-image` route's hash is its
  // source's, and the static file convention takes its alt from a `.txt` outside the catalogue.
  openGraph: {
    ...SITE_OPEN_GRAPH,
    images: [{ url: shareImage.src, width: shareImage.width, height: shareImage.height, alt: SERVER_COPY.shareImage.alt }],
  },
  // Without this X falls back to a small square thumbnail; the rest is inherited.
  twitter: {
    card: "summary_large_image",
  },
};

/**
 * No page has a boundary above it, so a route's prerendered shell is empty, which the build would otherwise refuse. The
 * root is the highest `instant` config of every route, and the shell's check obeys the highest one, so `false` here
 * lifts it for each route; it is the lowest place that covers them all. It does not lift the development server's
 * check of a navigation between two pages below it, which `next dev` runs at Next's default level and which warns.
 */
export const instant = false;

/**
 * The browser's own ground and controls in the visitor's system scheme wherever neither the stylesheet nor the theme
 * script has set them yet, which is only in a bare error document. Once the theme script runs it writes the chosen
 * theme's `color-scheme` on the root, which wins over this. It reaches an error document rendered per request and
 * Next's own not-found document; an error document the build prerenders, as the area's catch-all, carries no viewport.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
};

/** `modal` is the slot where a match row, on the landing or a season page, opens its match as a pop-up. */
export default function RootLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      // The viewport's scroll container is `<html>`, never `<body>`. Its track always shows: a page that grows
      // keeps the content's width, and a full-width line meets the track, where a reserved gutter would
      // stand empty beyond the line on a short page.
      className={`${anton.variable} ${raleway.variable} ${inter.variable} overflow-y-scroll`}>
      {/* No containing-block trigger on either root: one would make
          the page the containing block for every portalled overlay. */}
      <body className="flex min-h-dvh w-full flex-col bg-bg font-primary text-fg antialiased">
        <BrandSprite />
        <RootProviders>
          <ThemeColor />
          {/* No boundary above the pages: a page opened by address is one document, and a click keeps the page it
              leaves until the next is complete. */}
          <WholePages>
            {children}
            {modal}
          </WholePages>
        </RootProviders>
      </body>
    </html>
  );
}
