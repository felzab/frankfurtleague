import { INSTAGRAM_URL, KONTAKT_EMAIL, SITE_URL, THREADS_URL, VEREIN_ANSCHRIFT, VEREIN_NAME } from "@/core/brand";
import { COPY } from "@/core/copy";

/**
 * The league as schema.org describes it, for search engines, on the landing: `SportsOrganization`, the
 * subtype of `Organization` naming "sports teams, governing bodies, and sports associations"
 * (https://schema.org/SportsOrganization), since Google asks for "the most specific schema.org subtype of
 * Organization that matches your organization" (https://developers.google.com/search/docs/appearance/structured-data/organization).
 * Its logo is the installed app's 512-px icon, past Google's 112-px floor.
 */
const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: COPY.brand.name,
  legalName: VEREIN_NAME,
  sport: "Fußball",
  url: SITE_URL,
  logo: `${SITE_URL}/icons/manifest/icon-512.png`,
  email: KONTAKT_EMAIL,
  address: VEREIN_ANSCHRIFT,
  sameAs: [INSTAGRAM_URL, THREADS_URL],
};

/**
 * The block as React's `<script>` with a string child (https://react.dev/reference/react-dom/components/script),
 * which the server writes with every `<script` and `</script` in it escaped, so no value can end the block early.
 * A data block, which no browser runs.
 */
export function OrganizationJsonLd() {
  return <script type="application/ld+json">{JSON.stringify(ORGANIZATION)}</script>;
}
