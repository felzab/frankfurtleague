// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp } from "@/core/generated/zod/inputs";
import { SERVER_COPY } from "@/core/serverCopy";

import { BerichtEditor } from "./BerichtEditor";

import type { ActionAnswer } from "@/core/action";
import type { EditorSave } from "@/kit/useEditor";
import type { BerichtValues } from "./berichtValues";

const SPIEL_ID = "64b000000000000000000001";

vi.mock("next/navigation", () => ({
  usePathname: () => `/area/schiedsrichter/2027/spielbericht/${SPIEL_ID}`,
  useParams: () => ({ saison: "2027", spiel: SPIEL_ID }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

/** The empty first report as the page opens it on a match the league holds Weide's no-show for. */
const OPENED: BerichtValues = { sonderereignis: "nichtantreten_team2", shootOut1: "", shootOut2: "", scorers: [], cards: [], remarks: "" };

// The harm: the page shows the league's no-show while the save stores „Keines“, and the match editor then offers that
// report's 0:0 over the no-show, which nothing on the referee's page showed them.
describe("a first report opened at the league's no-show", () => {
  it("sends the no-show with the report, though the referee saved the form untouched", async () => {
    const save = vi.fn(async (_sent: EditorSave<BerichtValues, number | null>): Promise<ActionAnswer<number>> => ({ ok: true, value: 1 }));
    render(
      <BerichtEditor
        title={{ record: "Birke vs. Weide" }}
        lead={COPY.spielplan.when(null, null)}
        record={{ id: SPIEL_ID, version: null, values: OPENED }}
        save={save}
        phase="gruppenphase"
        sides={{
          team1: { name: { record: "Birke" }, plaque: { record: "BIR" } },
          team2: { name: { record: "Weide" }, plaque: { record: "WEI" } },
        }}
        squads={{ team1: [], team2: [] }}
        minute={{ pattern: spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp.source }}
        required={{ minute: true, goalPlayer: true, cardPlayer: true, side: true, cardColour: true }}
        eigentor={SERVER_COPY.season.spiel.eigentor}
        remarksMax={500}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].changes.sonderereignis).toBe("nichtantreten_team2");
  });
});
