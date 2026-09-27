import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand.ts";
import { DATENSCHUTZ_STAND } from "@/features/meta/constants.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import sitemap from "./sitemap.ts";

import type { ComponentType } from "react";

const { ImpressumView } = await import("@/features/meta/components/views/ImpressumView.tsx");
const { MetaOrganisationView } = await import("@/features/meta/components/views/MetaOrganisationView.tsx");

const lastModifiedOf = (route: string): unknown => sitemap().find((entry) => entry.url === `${SITE_URL}${route}`)?.lastModified;

/** Every word a view renders, so a change of class or of markup alone leaves its date standing. */
const wortlautDigest = (View: ComponentType<object>): string =>
  createHash("sha256")
    .update(textOf(renderMarkup(View, {}), " ").replace(/\s+/g, " ").trim(), "utf8")
    .digest("hex");

/**
 * Each date frozen beside the words it dates: a crawler told a page is unchanged since that day has
 * been misled by any edit that left the date standing.
 */
const FASSUNGEN = [
  {
    route: "/impressum",
    View: ImpressumView,
    stand: "2026-09-24",
    digest: "1a623b0f219eef20194127195c5ec1c88aabb65e3046a4634f1a52cfc9af7cfc",
  },
  {
    route: "/organisation",
    View: MetaOrganisationView,
    stand: "2026-09-24",
    digest: "5493bd6bd90fbb9561ae840b2583eaf9fb2da9b722aca963fe37c05ce187235f",
  },
];

describe("the dates the sitemap hands a crawler", () => {
  it("dates a page whose words are all this code's to the day those words took effect", () => {
    for (const { route, View, stand, digest } of FASSUNGEN) {
      assert.equal(
        wortlautDigest(View),
        digest,
        `${route}'s words changed: move sitemap.ts :: WORDING_TOOK_EFFECT for it to the day they land, then this entry to that day and this digest`,
      );
      assert.equal(lastModifiedOf(route), stand, `${route}'s date moved while its words did not`);
    }
  });

  /* Its words are tied to their „Stand“ by `fl_frontend/src/features/meta/components/views/DatenschutzView.test.ts`. */
  it("dates the privacy notice by the „Stand“ the notice itself shows", () => {
    assert.equal(lastModifiedOf("/datenschutz"), DATENSCHUTZ_STAND);
  });

  /* League data changes with every result, and a crawler that meets one wrong date trusts none of them. */
  it("dates no other page", () => {
    const dated = new Set([...FASSUNGEN.map(({ route }) => `${SITE_URL}${route}`), `${SITE_URL}/datenschutz`]);
    const undated = sitemap().filter((entry) => !dated.has(entry.url));

    assert.ok(undated.length > 5, "the sitemap lists almost no page besides the dated ones, so the check below reaches nothing");
    for (const entry of undated) assert.equal(entry.lastModified, undefined, `${entry.url} carries a date no build can keep true`);
  });
});
