// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatList } from "@/core/format";
import { AUSTRITT_RULES, SEAT_RULES, TEAM_DESCRIPTION_MAX, TEAM_SAVE_RULES } from "@/features/teams/fieldRules";
import { renderUnderNext } from "@/test-support/nextContexts";

import { recordAustritt } from "./teamActs";
import { TeamEditor } from "./TeamEditor";

import type { NextContexts } from "@/test-support/nextContexts";
import type { TeamRow } from "./TeamEditor";
import type { TeamValues } from "./teamValues";

vi.mock("./teamActs", () => ({
  recordAustritt: vi.fn(),
  reactivateTeam: vi.fn(),
  retireTeam: vi.fn(),
  sendSeatLink: vi.fn(),
  writeSeat: vi.fn(),
}));
vi.mock("./invitationActs", () => ({ mailInvitation: vi.fn(), mintInvitation: vi.fn(), revokeInvitation: vi.fn() }));
const AT_ADDRESS: NextContexts = {
  pathname: "/admin/saisons/2027/teams/64b000000000000000000001",
  params: { saison: "2027", team: "64b000000000000000000001" },
};

const VALUES: TeamValues = {
  name: "Ahorn",
  shorthand: "AHORN",
  full_name: "Ahorn-Gymnasium",
  schulform: "",
  website_url: "",
  description: "",
  street: "Ahornweg",
  house_number: "1",
  postcode: "60311",
  district: "",
  city: "Frankfurt am Main",
  gruppe: "A",
  trikot_farbe: "",
};

const ROW: TeamRow = {
  saisonTitle: COPY.shared.saisonName("2027"),
  gruppen: [{ id: "A", label: COPY.shared.season.gruppe("A") }],
  gruppeLocked: null,
  colours: [],
  colourLocked: null,
  austritt: null,
  version: 1,
  seats: [],
  invitation: { facts: [], live: null },
  exit: {
    earliest: dayOf("2027-03-01"),
    today: dayOf("2027-04-20"),
    recipients: [
      { date: "2027-04-20", recipients: [{ kind: "team", team_id: "64b000000000000000000002", name: "Bieber" }] },
      { date: "2027-04-27", recipients: [{ kind: "schiedsrichter", schiedsrichter_id: "64b0000000000000000000c1", name: "Otto Gruber" }] },
    ],
  },
};

/** The editor of one club in its season, its exit dialog opened from the danger row, whose button carries its verb. */
async function openExit() {
  renderUnderNext(
    <TeamEditor
      team="64b000000000000000000001"
      saison="2027"
      title={{ record: VALUES.full_name }}
      record={{ id: "64b000000000000000000001", version: 1, values: VALUES }}
      save={vi.fn()}
      rules={TEAM_SAVE_RULES}
      descriptionMax={TEAM_DESCRIPTION_MAX}
      seatRules={SEAT_RULES}
      holder="admin@example.org"
      austrittRules={AUSTRITT_RULES}
      retirement={{ kind: "retire" }}
      row={ROW}
    />,
    AT_ADDRESS,
  );
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.enter }));
  return screen.findByRole("dialog");
}

/* The fact is the administrator's one sight of whom the exit mails: read for today whatever day is typed, it names an
   opponent whose match lies before the exit, who is never mailed. */
describe("the exit dialog's „E-Mail an“", () => {
  it("names whom an exit from the day typed mails", async () => {
    const dialog = await openExit();
    const mailTo = () => within(dialog).getByText(ADMIN_COPY.facts.mailTo).nextElementSibling?.textContent;
    expect(mailTo()).toBe(formatList(["Bieber", "Otto Gruber"]));

    // The day's segment first: typing 21 moves the exit past Bieber's match on the 20th.
    const [day] = within(dialog).getAllByRole("spinbutton");
    await userEvent.click(day as HTMLElement);
    await userEvent.keyboard("21");

    expect(mailTo()).toBe("Otto Gruber");
  });
});

// The harm: a refusal of the exit's kind shown nowhere, the focus left on the dialog's act.
describe("the exit dialog's kind", () => {
  it("takes a refusal of the kind on its choice, which takes the focus", async () => {
    const fault = COPY.shared.field.required;
    vi.mocked(recordAustritt).mockResolvedValueOnce({ ok: false, fieldErrors: { type: fault } });
    const dialog = await openExit();
    await userEvent.type(within(dialog).getByRole("textbox", { name: COPY.shared.reason }), "Zurückgezogen");

    await userEvent.click(within(dialog).getByRole("button", { name: COPY.shared.verb.enter }));

    const kind = await within(dialog).findByRole("radiogroup", { name: ADMIN_COPY.team.austrittType });
    await within(kind).findByText(fault);
    expect(kind.contains(document.activeElement)).toBe(true);
  });
});
