// @vitest-environment jsdom
import { getDefaultNormalizer, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { SPIELORT_RULES } from "../../../../../spielortRules";
import { SpielEditor } from "./SpielEditor";
import { NO_SONDEREREIGNIS } from "./spielValues";

import type { ActionAnswer } from "@/core/action";
import type { Adoption } from "./SpielEditor";
import type { SpielValues } from "./spielValues";

const WORDS = COPY.admin.spiel;
const SPIEL_ID = "64b000000000000000000001";

vi.mock("next/navigation", () => ({
  usePathname: () => `/admin/saisons/2027/spiele/${SPIEL_ID}`,
  useParams: () => ({ saison: "2027", spiel: SPIEL_ID }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

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
  sonderereignis: NO_SONDEREREIGNIS,
  note: "",
};

/** The referee's report at its second version, proposing the same 1:0. */
const ADOPTION: Adoption = {
  version: 2,
  text: WORDS.fromReport(WORDS.score({ team1: 1, team2: 0 }, null)),
  values: { sonderereignis: NO_SONDEREREIGNIS, hasResult: true, tore1: "1", tore2: "0", shootOut1: "", shootOut2: "" },
};

function Editor({ save }: { save: Parameters<typeof SpielEditor>[0]["save"] }) {
  return (
    <SpielEditor
      title={{ record: "Ahorn vs. Eiche" }}
      preview={ADOPTION.text}
      record={{ id: SPIEL_ID, version: 3, values: STORED }}
      save={save}
      phase="gruppenphase"
      begun
      sides={{
        team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
        team2: { name: { record: "Eiche" }, plaque: { record: "EIC" } },
      }}
      quellen={{ team1: null, team2: null }}
      clubs={null}
      spielorte={[]}
      schiedsrichter={[]}
      sonderereignisse={[{ id: NO_SONDEREREIGNIS, label: WORDS.none }]}
      noteMax={500}
      required={{ mietpreis: true, payment: true }}
      report={{ head: { nameLabel: COPY.shared.spieler, stack: true, columns: [] }, rows: [] }}
      adoption={ADOPTION}
      answers={[]}
      aufstellungen={[]}
      createSpielort={async (): Promise<ActionAnswer> => ({ ok: true, value: undefined })}
      spielortRules={SPIELORT_RULES}
    />
  );
}

// The harm: a report agreeing with a result typed in by hand reads as differing for good and its cards never reach the
// public page, nothing on the editor letting the administrator adopt it.
describe("a report whose proposal the fields already hold", () => {
  it("is offered for adoption, the press counting as one change whose save stamps the report", async () => {
    const save = vi.fn(async (): Promise<ActionAnswer<number>> => ({ ok: true, value: 4 }));
    render(<Editor save={save} />);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.adopt }));

    // The count keeps its no-break space, which the default normaliser would collapse.
    expect(screen.getByText(COPY.template.changesPending(1), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    // No field of the match changed: the press is the whole save.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: SPIEL_ID, version: 3, changes: {}, adoptsBericht: 2 }));
  });
});
