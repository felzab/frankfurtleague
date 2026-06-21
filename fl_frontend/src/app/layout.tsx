import "./globals.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter, Krub } from "next/font/google";
import TopNav from "@/shared/components/layout/topnav/TopNav";
import Footer from "@/shared/components/layout/Footer";
import RootProviders from "@/core/providers/RootProviders";

/** Fonts */
const inter = Inter({
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const krub = Krub({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-krub",
});

/** Metadata */
export const metadata: Metadata = {
  title: {
    template: "%s | Frankfurt-League",
    default: "Frankfurt-League | Die Oberstufenliga",
  },
  description:
    "Bei der Frankfurt-League treten Frankfurter Oberstufen gegeneinander an, um herauszufinden, welche von ihnen die Beste ist. Hier gibt's alle Infos",
  keywords: [
    "Frankfurt-League",
    "Frankfurt-league",
    "Frankfurt league",
    "Frankfurtleague",
    "frankfurtleague.de",
    "Frankfurt-Fußball-League",
    "Frankfurt-Fussball-League",
    "Frankfurter",
    "Oberstufen",
    "Fussbal",
    "Fußball",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de",
  },
  openGraph: {
    title: "Frankfurt-League",
    description: "Die Frankfurt-League. Der Wettkamp der Oberstufen",
    url: "https://frankfurtleague.de",
    siteName: "Frankfurt-League",
    images: [
      {
        url: "https://frankfurtleague.de/icons/opengraph/opengraph.png",
        width: 1200,
        height: 630,
        alt: "FL-Preview",
      },
    ],
    locale: "de_DE",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      id="doc_html"
      lang="de"
      suppressHydrationWarning
      className={`${inter.variable} ${krub.variable}`}>
      <body>
        <RootProviders>
          <header id="top">
            <Suspense>
              <TopNav />
            </Suspense>
          </header>

          <main id="doc_main">{children}</main>

          <footer>
            <Footer />
          </footer>
        </RootProviders>
      </body>
    </html>
  );
}
