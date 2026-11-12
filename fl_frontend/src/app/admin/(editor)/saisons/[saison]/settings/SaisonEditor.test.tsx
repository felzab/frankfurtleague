// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SAISON_REQUIRED } from "@/features/saisons/required";

import { SaisonEditor } from "./SaisonEditor";

import type { SaisonValues } from "./saisonValues";

const WORDS = COPY.admin.saison;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/saisons/2026/settings",
  useParams: () => ({ saison: "2026" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

const VALUES: SaisonValues = {
  start: "2026-09-01",
  end: "2027-06-30",
  winPoints: "3",
  drawPoints: "1",
  lossPoints: "0",
  tiebreak: "tordifferenz",
  gruppen: "2",
  teamsPerGruppe: "4",
  qualifiers: "2",
  maxKader: "20",
  stufen: ["Q1", "Q2"],
  forfeitWinner: "3",
  forfeitLoser: "0",
  bewerbungStart: null,
  bewerbungEnd: null,
  bewerbungPaused: false,
  registrierungEnd: null,
  registrierungPaused: false,
};

const act = vi.fn();

/** The editor of a running season whose draw stands and one of whose matches has taken place. */
function Running() {
  return (
    <SaisonEditor
      saison="2026"
      title={COPY.shared.saisonName("2026")}
      chip={{ tone: "success", label: COPY.admin.confirmed }}
      record={{ id: "2026", version: 1, values: VALUES }}
      save={async () => ({ ok: true, value: 2 })}
      required={SAISON_REQUIRED}
      facts={{
        begun: true,
        takenPlace: true,
        isCurrent: true,
        siteShows: "2026",
        spielplan: { spieltage: 6, spiele: 24, drawnOn: "2026-08-01" },
        locked: {},
      }}
      shapes={[]}
      clubs={[]}
      incoming={[]}
      links={{ head: { nameLabel: COPY.shared.facts.team, linked: false, columns: [] }, rows: [], mailed: 0 }}
      holder="admin@example.com"
      acts={{ draw: act, recreate: act, undraw: act, activate: act, swap: act, replace: act, sendLinks: act }}
    />
  );
}

// The harm: a lock line naming a whole box the start holds only in part, so the administrator takes the no-show's goals
// for fixed and never sets them, or a lock reason said once per box, the line repeating itself.
describe("the season editor's lock line", () => {
  it("names each reason once and, of a box held in part, only the fields it holds", () => {
    const { container } = render(<Running />);
    const field = (name: keyof SaisonValues) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

    const line = screen.getByText(
      COPY.template.lockLine([
        ["takenPlace", WORDS.start],
        ["sinceStart", WORDS.punkte],
        ["sinceStart", WORDS.tiebreak],
        ["byDraw", WORDS.gruppen],
        ["byDraw", WORDS.teamsPerGruppe],
        ["sinceStart", WORDS.qualifiers],
        ["sinceStart", WORDS.gruppentausch],
        ["sinceStart", WORDS.replacement],
      ]),
    );
    // Counted on the line as drawn, apart from the catalogue's own composing of it.
    expect(line.textContent?.split(WORDS.lockedSinceStart)).toHaveLength(2);
    // The Wertung box's fields the line names stand read-only, and the ones it leaves out stay open.
    expect(field("winPoints")?.disabled).toBe(true);
    expect(field("forfeitWinner")?.disabled).toBe(false);
  });
});
