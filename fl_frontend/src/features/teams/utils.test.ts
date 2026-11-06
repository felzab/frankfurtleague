import { assert, describe, expect, it } from "vitest";

import { TRIKOT_FARBE_OPTIONS } from "./constants.ts";
import { FLTrikotFarbeSchema } from "./schemas.ts";
import { offeredTrikotFarben, toWebsiteUrl } from "./utils.ts";

describe("what a website box reports upward", () => {
  /* The scheme lives in the input group's prefix, so what the box holds is the rest of the URL. */
  it("puts the scheme back on whatever was typed", () => {
    expect(toWebsiteUrl("www.beispielschule.de")).toBe("https://www.beispielschule.de");
  });

  /* A pasted full address must not come back doubled. */
  it("de-duplicates a scheme that was pasted in with the address", () => {
    expect(toWebsiteUrl("https://www.beispielschule.de")).toBe("https://www.beispielschule.de");
    expect(toWebsiteUrl("HTTP://www.beispielschule.de")).toBe("https://www.beispielschule.de");
  });

  /* ONE spelling of "no website" is ever written, so no reader downstream tests for two. The
     club payload refuses `""` outright (`schemas.test.ts`), so an empty box reported as one would
     be refused rather than stored. */
  it("reports no website as null, never as the empty string", () => {
    expect(toWebsiteUrl("")).toBe(null);
    expect(toWebsiteUrl("   ")).toBe(null);
    expect(toWebsiteUrl("https://")).toBe(null);
  });
});

describe("the kit palette", () => {
  /* The option's type refuses a colour the wire does not carry, never one the palette leaves out,
     which would read with no name and no swatch on every row storing it. */
  it("names and draws every colour the wire carries, once each and in the wire's order", () => {
    expect(TRIKOT_FARBE_OPTIONS.map((option) => option.value)).toStrictEqual(FLTrikotFarbeSchema.options);
  });
});

describe("which kit colours the wish picker offers", () => {
  const alle = TRIKOT_FARBE_OPTIONS.map((option) => option.value);
  const values = (vergeben: readonly (typeof alle)[number][], value: (typeof alle)[number] | null = null) =>
    offeredTrikotFarben({ taken: vergeben, value: value }).map((option) => option.value);

  /* First, because every case below compares against the palette: a filter that had stopped reading
     `TRIKOT_FARBE_OPTIONS` would return nothing and make each of them pass over an empty list. */
  it("offers the whole palette while nothing is assigned", () => {
    expect(values([])).toStrictEqual(alle);
    assert.ok(alle.length > 1, "the palette holds one colour or none, so no exclusion below can be observed");
  });

  /* The colours an administrator ASSIGNED, off `saison_teams.trikot_farbe` and never off another
     application's wish -- reading wishes would carry one school's submission into another's form. */
  it("leaves out every colour the season has assigned", () => {
    const uebrig = values(["rot", "blau"]);

    assert.ok(!uebrig.includes("rot"), "an assigned colour is still offered");
    assert.ok(!uebrig.includes("blau"), "an assigned colour is still offered");
    expect(uebrig.length, "the exclusion dropped something other than the two assigned colours").toBe(alle.length - 2);
  });

  /* Order carries the palette's, so a school reads the same list it reads everywhere else. */
  it("keeps the palette's own order in what is left", () => {
    const uebrig = values(["rot"]);

    expect(uebrig).toStrictEqual(alle.filter((farbe) => farbe !== "rot"));
  });

  /* A stored assignment stays pickable in its own editor: without this, reopening a saved row would
     offer every colour except the one it holds. */
  it("keeps the colour the field already holds", () => {
    assert.ok(values(["rot", "blau"], "rot").includes("rot"), "the field's own colour was excluded from its own picker");
  });

  /* The boundary the palette can cross on its own: more teams than colours. An empty offer is the
     answer there, and the field stays required: the picker offers only what the season can still
     give. */
  it("offers nothing once the season has assigned every colour", () => {
    expect(values(alle)).toStrictEqual([]);
  });

  /* And only there: emptied a colour early, the picker would withhold one the season still has. */
  it("still offers the last colour the season has left", () => {
    expect(values(alle.slice(1))).toStrictEqual(alle.slice(0, 1));
  });

  /* The held value survives the exhausted season as well, its own colour being by definition one of
     the assigned ones -- so an editor reopening such a row still reads what it holds. */
  it("keeps the field's own colour even where every colour is assigned", () => {
    expect(values(alle, "rot")).toStrictEqual(["rot"]);
  });
});
