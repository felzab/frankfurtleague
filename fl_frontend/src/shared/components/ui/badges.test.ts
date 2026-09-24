import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countBadge, labelBadge, PILL_SOLID_CLASSES, PILL_TINT_CLASSES, trackCountBadge, trackLabelBadge } from "./badges.ts";

import type { FeedbackTone, PillTone } from "./badges.ts";

/**
 * Spelled out rather than read off `PILL_SOLID_CLASSES`, which is the record the cases below grade: a list
 * derived from it would grade a fifth tone by nothing and a retired one not at all.
 */
const SOLID_TONES: readonly FeedbackTone[] = ["success", "warning", "danger", "info"];

const TONES: readonly PillTone[] = [
  "success",
  "warning",
  "danger",
  "info",
  "brand",
  "brandSolid",
  "gruppenphase",
  "achtelfinale",
  "viertelfinale",
  "halbfinale",
  "finale",
];

describe("the closed set every pill takes its colour from", () => {
  /* A tone with no fill or no ink paints half a chip, which renders and reports nothing; the neutral
     pair readmitted under a tone name puts it back in the closed set (`docs/frontend/spec.md :: I170`). */
  it("gives every tone a fill and an ink, and none of them the refused pair", () => {
    assert.deepEqual([...TONES].sort(), Object.keys(PILL_TINT_CLASSES).sort(), "the set and this case's list no longer name the same tones");

    for (const tone of TONES) {
      const tokens = PILL_TINT_CLASSES[tone].split(/\s+/);

      assert.ok(
        tokens.some((token) => token.startsWith("bg-")) && tokens.some((token) => token.startsWith("text-")),
        `\`${tone}\` is ${PILL_TINT_CLASSES[tone]}, which paints no chip`,
      );
      assert.ok(!tokens.includes("bg-muted") && !tokens.includes("text-foreground-muted"), `\`${tone}\` is the refused pair under a name`);
    }
  });

  /* The shape a caller composes is the shape plus the tone, so a pill cannot exist with the tone
     left off. */
  it("carries the tone's own pair into the pill it composes", () => {
    for (const tone of TONES) {
      assert.ok(labelBadge(tone).endsWith(PILL_TINT_CLASSES[tone]), `\`${tone}\` composes to ${labelBadge(tone)}, which drops its own pair`);
    }
  });

  /* A solid pair with a fill and no ink, or an ink and no fill, paints half a chip and reports
     nothing, which is what the tinted set is already held to. */
  it("gives every solid tone a fill and its paired on-colour, and none of them the refused pair", () => {
    assert.deepEqual(
      [...SOLID_TONES].sort(),
      Object.keys(PILL_SOLID_CLASSES).sort(),
      "the set and this case's list no longer name the same tones",
    );

    for (const tone of SOLID_TONES) {
      const tokens = PILL_SOLID_CLASSES[tone].split(/\s+/);

      assert.ok(
        tokens.some((token) => token.endsWith("-solid") && token.startsWith("bg-")) &&
          tokens.some((token) => token.endsWith("-solid-foreground") && token.startsWith("text-")),
        `\`${tone}\` is ${PILL_SOLID_CLASSES[tone]}, which is not a fill under its on-colour`,
      );
      assert.ok(!tokens.includes("bg-muted") && !tokens.includes("text-foreground-muted"), `\`${tone}\` is the refused pair under a name`);
    }
  });

  /* Both recipes carry the tone's own pair, so neither can exist with the tone left off
     (`docs/frontend/spec.md :: I229`). */
  it("carries each ground's own pair into the count it composes", () => {
    for (const tone of TONES) {
      assert.ok(countBadge(tone).endsWith(PILL_TINT_CLASSES[tone]), `\`${tone}\` composes to ${countBadge(tone)}, which drops its own tint`);
    }
    for (const tone of SOLID_TONES) {
      assert.ok(
        trackCountBadge(tone).endsWith(PILL_SOLID_CLASSES[tone]),
        `\`${tone}\` composes to ${trackCountBadge(tone)}, which drops its own fill`,
      );
    }
  });

  /* A word takes the same two shapes a count does, a ground the tint cannot survive carrying both
     (`docs/frontend/spec.md :: I229`). */
  it("carries the solid ground's own pair into the word it composes", () => {
    for (const tone of SOLID_TONES) {
      assert.ok(
        trackLabelBadge(tone).endsWith(PILL_SOLID_CLASSES[tone]),
        `\`${tone}\` composes to ${trackLabelBadge(tone)}, which drops its own fill`,
      );
    }
  });

  /* The neutral-pill ban in `fl_frontend/eslint.config.mjs :: SOURCE_BANS` finds a pill module by
     this export's name and this module's, both strings there, so a rename leaves it matching
     nothing. Both are strings here too, which an identifier rename leaves standing. */
  it("still exports the radius the neutral-pill ban finds a pill module by", async () => {
    const badges = (await import(new URL("./badges.ts", import.meta.url).href)) as Record<string, unknown>;

    assert.equal(typeof badges["PILL_RADIUS_CLASSES"], "string", "the ban's population is keyed on an export this module no longer has");
  });
});
