import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

import { spielFields } from "@/shared/testing/fixtures.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

import { FLSpielSchema } from "../../schemas.ts";
import { computeSpielStatus } from "../../utils.ts";

import type { FLSonderereignis, FLSpielWithDraftFields } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielStatusChip } = await import("./SpielStatusChip.tsx");
const { SpielCard } = await import("./SpielCard.tsx");
const { SpielDraftPreview } = await import("../forms/AdminEditSpielDataForm/SpielDraftPreview.tsx");

const TODAY = "2026-05-02";
const TOMORROW = "2026-05-03";
const YESTERDAY = "2026-05-01";

/** The chip's word for a fixture on `datum`, through the scheduling derivation the card runs and the verdict the read served. */
function wordFor(datum: string, ansetzungBestaetigt: boolean | null, sonderereignis: FLSonderereignis | null = null): string {
  const spielStatus = computeSpielStatus({ datum, sonderereignis, today: TODAY });
  const { container, unmount } = render(h(SpielStatusChip, { spielStatus, ansetzungBestaetigt }));
  const word = container.textContent;
  unmount();

  return word;
}

describe("what the status chip says about a fixture's confirmation", () => {
  it("marks a fixture still to come „Vorläufig“ where the clubs were asked and have not both confirmed", () => {
    assert.equal(wordFor(TOMORROW, false), "Vorläufig");
  });

  // The verdict stays `false` through the day itself, a row minted last week still being open, so a chip keyed on
  // the verdict alone takes „Heute“ off the most-read page on every match day.
  it("lets the scheduling state win from match day on", () => {
    assert.equal(wordFor(TODAY, false), "Heute");
    assert.equal(wordFor(YESTERDAY, false), "Vergangen");
  });

  // A call-off changes none of the five values, so the rows still match until the hourly close: a chip yielding to
  // „Heute“ and „Vergangen“ alone would call a cancelled fixture provisional.
  it("lets a call-off win over the verdict", () => {
    assert.equal(wordFor(TOMORROW, false, "ausgefallen"), "Abgesagt");
  });

  // Folding `null` into `false` would call every fixture nobody was ever asked about provisional.
  it("reads a fixture nobody was asked about, and a confirmed one, exactly as before", () => {
    assert.equal(wordFor(TOMORROW, null), "Ausstehend");
    assert.equal(wordFor(TOMORROW, true), "Ausstehend");
  });
});

/** A fixture dated tomorrow whose clubs were asked and have not both confirmed. */
const PROVISIONAL = FLSpielSchema.parse(spielFields({ datum: TOMORROW, uhrzeit: "18:00:00", ansetzung_bestaetigt: false }));

describe("which mounts pass the verdict to the chip", () => {
  it("puts „Vorläufig“ on the public card", () => {
    const text = textOf(
      renderMarkup(SpielCard, { spielData: PROVISIONAL, onOpenInfoModal: () => undefined, today: TODAY, isFinishedSaison: false }),
    );

    assert.match(text, /Vorläufig/);
  });

  // The verdict is about the STORED Ansetzung, so the preview reads what the editor hands it rather than the draft's
  // copy of the served field, which a moved draft still carries (`AdminEditSpielDataForm/voidPreview.test.ts`).
  it("puts it on the editor's draft preview as handed, never off the draft", () => {
    const draft: FLSpielWithDraftFields = { ...PROVISIONAL, ort: null, schiedsrichter: null };
    const preview = (ansetzungBestaetigt: boolean | null) =>
      textOf(
        renderMarkup(SpielDraftPreview, { previewSpiel: draft, ansetzungBestaetigt, today: TODAY, isDirty: false, isFinishedSaison: false }),
      );

    assert.match(preview(false), /Vorläufig/);
    assert.match(preview(null), /Ausstehend/);
    assert.doesNotMatch(preview(null), /Vorläufig/);
  });
});
