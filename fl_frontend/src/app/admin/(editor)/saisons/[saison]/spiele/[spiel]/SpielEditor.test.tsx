// @vitest-environment jsdom
import { getDefaultNormalizer, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { SpielEditor } from "./SpielEditor";

import type { ActionAnswer } from "@/core/action";
import type { SpielValues } from "@/features/spiele/spielValues";
import type { NextContexts } from "@/test-support/nextContexts";
import type { Adoption } from "./SpielEditor";

const WORDS = ADMIN_COPY.spiel;
const SPIEL_ID = "64b000000000000000000001";

const AT_ADDRESS: NextContexts = { pathname: `/admin/saisons/2027/spiele/${SPIEL_ID}`, params: { saison: "2027", spiel: SPIEL_ID } };

/** A played group match whose stored 1:0 the administrator typed in by hand. */
const STORED: SpielValues = {
  team1: "64b000000000000000000003",
  team2: "64b000000000000000000004",
  date: null,
  time: null,
  spielort: null,
  mietpreis: "",
  schiedsrichter: null,
  payment: "",
  hasResult: true,
  tore1: "1",
  tore2: "0",
  shootOut1: "",
  shootOut2: "",
  sonderereignis: "",
  note: "",
};

/** The referee's report at its second version, proposing the same 1:0. */
const ADOPTION: Adoption = {
  version: 2,
  text: WORDS.fromReport(COPY.spielplan.score({ team1: 1, team2: 0 }, null)),
  values: { sonderereignis: "", hasResult: true, tore1: "1", tore2: "0", shootOut1: "", shootOut2: "" },
};

/** The Sonderereignis select's entries: „Keines“ first, which the save reads as no event, then two events. */
const SONDEREREIGNISSE = [
  { id: "", label: COPY.spielplan.sonderereignis.none },
  { id: "abgebrochen", label: COPY.spielplan.sonderereignis.abgebrochen },
  { id: "ausgefallen", label: COPY.spielplan.sonderereignis.ausgefallen },
];

function Editor({
  save,
  values = STORED,
  closed,
}: {
  save: Parameters<typeof SpielEditor>[0]["save"];
  values?: SpielValues;
  closed?: Parameters<typeof SpielEditor>[0]["closed"];
}) {
  return (
    <SpielEditor
      title={{ record: "Ahorn vs. Eiche" }}
      preview={ADOPTION.text}
      record={{ id: SPIEL_ID, version: 3, values }}
      save={save}
      phase="gruppenphase"
      begun
      sides={{
        team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
        team2: { name: { record: "Eiche" }, plaque: { record: "EIC" } },
      }}
      quellen={{ team1: null, team2: null }}
      teams={null}
      spielorte={[]}
      schiedsrichter={[]}
      sonderereignisse={SONDEREREIGNISSE}
      rules={{}}
      report={{ head: { nameLabel: COPY.shared.spieler, stack: true, columns: [] }, rows: [] }}
      adoption={ADOPTION}
      answers={[]}
      aufstellungen={[]}
      createSpielort={async (): Promise<ActionAnswer> => ({ ok: true, value: undefined })}
      spielortRules={{}}
      {...(closed === undefined ? {} : { closed })}
    />
  );
}

// The harm: a report agreeing with a result typed in by hand reads as differing for good and its cards never reach the
// public page, nothing on the editor letting the administrator adopt it.
describe("a report whose proposal the fields already hold", () => {
  it("is offered for adoption, the press counting as one change whose save stamps the report", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 4 }));
    renderUnderNext(<Editor save={save} />, AT_ADDRESS);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.adopt }));

    // The count keeps its no-break space, which the default normaliser would collapse.
    expect(screen.getByText(COPY.template.changesPending(1), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    // No field of the match changed: the press is the whole save.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: SPIEL_ID, version: 3, changes: {}, adoptsBericht: 2 }));
  });
});

// The harm: a finished season's match promising with „Noch keine …“ goals and answers that can no longer come.
describe("the editor's empty lists", () => {
  const save = async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 4 });

  it("say none is to come on a finished season's match, and none yet on an open one", () => {
    const { unmount } = renderUnderNext(
      <Editor
        save={save}
        closed={COPY.shared.saison}
      />,
      AT_ADDRESS,
    );
    expect(screen.getByText(COPY.shared.empty.unrecorded(COPY.shared.tore))).toBeTruthy();
    expect(screen.getByText(COPY.shared.empty.unrecorded(WORDS.confirmations))).toBeTruthy();
    unmount();

    renderUnderNext(<Editor save={save} />, AT_ADDRESS);
    expect(screen.getByText(COPY.shared.empty.none(COPY.shared.tore))).toBeTruthy();
    expect(screen.getByText(COPY.shared.empty.none(WORDS.confirmations))).toBeTruthy();
  });
});

// The harm: an event set on a match by mistake that the editor cannot take back, „Keines“ picked and nothing changing.
describe("the Sonderereignis select", () => {
  it("takes „Keines“ back as chosen after an event, posting and saving it as the empty entry", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 4 }));
    renderUnderNext(
      <Editor
        save={save}
        values={{ ...STORED, sonderereignis: "abgebrochen" }}
      />,
      AT_ADDRESS,
    );
    const { label, none, ausgefallen } = COPY.spielplan.sonderereignis;
    const trigger = () => screen.getByRole("button", { name: new RegExp(label) });

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("option", { name: ausgefallen }));
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("option", { name: none }));

    expect(trigger().textContent).toContain(none);
    expect(document.querySelector<HTMLSelectElement>('select[name="sonderereignis"]')?.value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    // The save reads the empty entry as no event (`blankIsNull`), as its own case holds.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: SPIEL_ID, version: 3, changes: { sonderereignis: "" }, adoptsBericht: null }));
  });
});
