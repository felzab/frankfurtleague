import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { formPanel } from "@/shared/components/ui/formPanel.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormSonderereignisSection } = await import("./FormSonderereignisSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

type PanelProps = Parameters<typeof FormSonderereignisSection>[0];

/** No descriptor for the field, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

const PANEL: PanelProps = {
  sonderereignis: null,
  hasSonderereignis: true,
  onHasSonderereignisChange: () => undefined,
  hasBothSides: true,
  onSonderereignisChange: () => undefined,
  banners: [],
};

const markup = (props: Partial<PanelProps>): string =>
  renderTree(h(DraftStatusProvider, { status: STATUS, children: h(FormSonderereignisSection, { ...PANEL, ...props }) }));

/**
 * The `<select>` react-aria mirrors the pick into, which is the half of the control a browser judges
 * a submit against. `null` where the panel rendered no select at all.
 */
const nativeSelect = (html: string): string | null => /<select [^>]*name="sonderereignis".*?<\/select>/s.exec(html)?.[0] ?? null;

describe("the Sonderereignis panel's pick", () => {
  /* The floor for the absence below, which a panel rendering nothing at all would satisfy. */
  it("renders the switch whether or not an event is asserted", () => {
    for (const hasSonderereignis of [true, false]) assert.match(markup({ hasSonderereignis }), /Sonderereignis eintragen/);
  });

  /* An asserted event nobody picked saves as `null`, which the write path accepts and the change
     list cannot report. Only the control can refuse it, and only on submit, through the browser. */
  it("refuses an empty pick at the control, which stands on the switch alone", () => {
    const armed = nativeSelect(markup({}));

    assert.notEqual(armed, null, "the switch is on and the panel renders no select");
    assert.match(armed ?? "", /\srequired=""/, "the browser lets an asserted event submit unpicked");
    // `required` refuses nothing by itself. What the submit is judged against is the empty member
    // holding the selection while no event has been chosen.
    assert.match(armed ?? "", /<option value="" [^>]*selected=""/, "an unpicked event submits as a chosen member");
    assert.doesNotMatch(nativeSelect(markup({ sonderereignis: "ausgefallen" })) ?? "", /<option value="" [^>]*selected=""/);

    assert.equal(nativeSelect(markup({ hasSonderereignis: false })), null, "the select stands without the switch");
  });

  /* A tint retyped at a call site is one that drifts from the panel around it, so both halves of
     the switch read the tone rather than a colour of their own. */
  it("takes the switch's tint from the panel's tone", () => {
    const danger = formPanel({ tone: "danger" });
    const neutral = formPanel({ tone: "neutral" });

    // Against the recipe's own two tones and never a class string: a literal keeps passing through a
    // retokenised recipe, and says nothing about which tone the switch took.
    assert.notEqual(danger.switchContent(), neutral.switchContent(), "the two tones are indistinguishable, so this proves nothing");
    assert.notEqual(danger.switchControl(), neutral.switchControl(), "the two tones are indistinguishable, so this proves nothing");

    const html = markup({});

    assert.ok(html.includes(danger.root()), "the panel grades itself as something other than destructive");
    assert.ok(html.includes(danger.switchContent()), "the switch's row carries a tint of its own");
    assert.ok(html.includes(danger.switchControl()), "the switch's track carries a tint of its own");
  });
});
