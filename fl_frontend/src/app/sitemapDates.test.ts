import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand.ts";
import { DATENSCHUTZ_STAND } from "@/features/meta/constants.ts";

import sitemap from "./sitemap.ts";

const DATENSCHUTZ = `${SITE_URL}/datenschutz`;

describe("the dates the sitemap hands a crawler", () => {
  /* Its words are tied to their „Stand“ by `fl_frontend/src/features/meta/components/views/DatenschutzView.test.ts`. */
  it("dates the privacy notice by the „Stand“ the notice itself shows", () => {
    assert.equal(sitemap().find((entry) => entry.url === DATENSCHUTZ)?.lastModified, DATENSCHUTZ_STAND);
  });

  /* League data changes with every result, a hand-set day stays true only while someone moves it, and a
     crawler that meets one wrong date trusts none of them. */
  it("dates no other page", () => {
    const undated = sitemap().filter((entry) => entry.url !== DATENSCHUTZ);

    assert.ok(undated.length > 5, "the sitemap lists almost no page besides the dated one, so the check below reaches nothing");
    for (const entry of undated) assert.equal(entry.lastModified, undefined, `${entry.url} carries a date no build can keep true`);
  });
});
