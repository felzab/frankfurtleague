import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { buildPatchSpielDataPayloadSchema, FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { formPanel } from "@/shared/components/ui/formPanel.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { formWiring } from "@/shared/testing/formWiring.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { SpielFieldPath } from "@/features/spiele/draftStatus.ts";

/* Every action the editor calls answers a save; what the case below reads is whether the save was sent at all. */
const { calls } = doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [], voidedFixtures: [], releasedFixtures: [] }),
});

doubleToasts();

const { FormSonderereignisSection } = await import("./FormSonderereignisSection.tsx");
const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { Form } = await import("@/shared/components/ui/Form.tsx");

type PanelProps = Parameters<typeof FormSonderereignisSection>[0];

const STATUS = declaredStatus<SpielFieldPath>(["sonderereignis"]);

const PANEL: PanelProps = {
  sonderereignis: null,
  hasSonderereignis: true,
  onHasSonderereignisChange: () => undefined,
  hasBothSides: true,
  onSonderereignisChange: () => undefined,
  banners: [],
};

/* Inside the shared `Form`, as the editor renders it: its `aria` mode is what decides whether the browser refuses anything. */
const markup = (props: Partial<PanelProps>): string =>
  renderTree(
    h(
      Form,
      { onSubmit: () => undefined, wiring: formWiring() },
      h(DraftStatusProvider, { status: STATUS, children: h(FormSonderereignisSection, { ...PANEL, ...props }) }),
    ),
  );

/** The `<select>` react-aria mirrors the pick into. `null` where the panel rendered no select at all. */
const nativeSelect = (html: string): string | null => /<select [^>]*name="sonderereignis".*?<\/select>/s.exec(html)?.[0] ?? null;

describe("the Sonderereignis panel's pick", () => {
  /* The floor for the absence below, which a panel rendering nothing at all would satisfy. */
  it("renders the switch whether or not an event is asserted", () => {
    for (const hasSonderereignis of [true, false]) assert.match(markup({ hasSonderereignis }), /Sonderereignis eintragen/);
  });

  /* The mark promises a refusal, and the shared form's `aria` mode leaves no browser to make it: the
     editor's own schema is what refuses an asserted event nobody picked. */
  it("marks an asserted event required, and the browser refuses nothing", () => {
    const html = markup({});
    const armed = nativeSelect(html);

    assert.notEqual(armed, null, "the switch is on and the panel renders no select");
    assert.match(html, /data-required="true"/, "an asserted event's pick carries no required mark");
    assert.doesNotMatch(armed ?? "", /\srequired=""/, "the browser refuses the pick, so the schema's refusal proves nothing");
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

/** A fixture with no event, both sides known, and nothing else that would hold a save back. */
const OHNE_EREIGNIS = FLSpielAdminSchema.parse(
  spielFields({
    id: "6890a1b2c3d4e5f607182901",
    spiel_nr: 1,
    saison_id: "2026",
    team1: side("68c1f0a2b3c4d5e6f7a8b9c1", { name: "SG Alpha", shorthand: "SA" }),
    team2: side("68c1f0a2b3c4d5e6f7a8b9c2", { name: "SG Beta", shorthand: "SB" }),
  }),
);

describe("the match editor's save of an asserted event", () => {
  /* The write path takes `null` as no event, so an asserted event left unpicked would save as none
     beside whatever else the admin changed. */
  it("refuses the save while the switch asserts an event nobody picked", async () => {
    const user = userEvent.setup();
    render(
      underNext(
        h(AdminEditSpielDataForm, {
          spielData: OHNE_EREIGNIS,
          teams: [],
          spielorte: [],
          schiedsrichter: [],
          saisonSpiele: [OHNE_EREIGNIS],
          numberOfGroups: 2,
          isFinishedSaison: false,
          today: "2026-09-14",
          categorize: () => new Set<never>(),
          pageHeader: { title: "Spiel 1" },
        }),
        { search: "saison_id=2026" },
      ),
    );

    await user.click(screen.getByRole("switch", { name: "Sonderereignis eintragen" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), { target: { value: "Halle getauscht" } });
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => settled());
    const confirm = screen.queryByRole("button", { name: "Trotzdem speichern" });
    if (confirm !== null) {
      await user.click(confirm);
      await act(async () => settled());
    }

    assert.deepEqual(
      calls.filter((call) => call.action === "patchAdminSpielDataAction"),
      [],
      "an asserted event nobody picked was saved as no event",
    );
    assert.ok(screen.getAllByText("Bitte wähle ein Sonderereignis.").length > 0, "the refusal names no reason at the pick");
  });

  /* The other half of the switch's rule: switched off, `null` is the answer and the schema asks nothing. */
  it("asks the pick of an asserted event alone", () => {
    const payload = {
      datum: null,
      uhrzeit: null,
      ort: null,
      schiedsrichter: null,
      team1: null,
      team2: null,
      team1_quelle: null,
      team2_quelle: null,
      elfmeterschiessen: null,
      notiz: null,
      spiel_id: "6890a1b2c3d4e5f607182901",
      sonderereignis: null,
    };

    assert.equal(buildPatchSpielDataPayloadSchema({ hasSonderereignis: false }).safeParse(payload).success, true);
    const asserted = buildPatchSpielDataPayloadSchema({ hasSonderereignis: true }).safeParse(payload);
    assert.deepEqual(
      asserted.error?.issues.map((issue) => issue.path.join(".")),
      ["sonderereignis"],
    );
  });
});
