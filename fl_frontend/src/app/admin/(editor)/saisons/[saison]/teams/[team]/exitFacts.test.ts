import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { dayOf, formatList } from "@/core/format";

import { exitFactsOf } from "./exitFacts";

import type { FLAustrittRecipients } from "@/core/generated/client/types";

const BIEBER = { kind: "team", team_id: "64b000000000000000000002", name: "Bieber" } as const;
const OTTO = { kind: "schiedsrichter", schiedsrichter_id: "64b0000000000000000000c1", name: "Otto Gruber" } as const;
const EULE = { kind: "team", team_id: "64b000000000000000000003", name: "Eule" } as const;

/* The exit mails only about the fixtures from its own day, so a fact naming every party the club's season holds promises
   mails to an opponent whose match lies before that day. */
describe("the exit's „E-Mail an“", () => {
  const entries: FLAustrittRecipients[] = [
    { date: "2027-04-20", recipients: [BIEBER, OTTO] },
    { date: "2027-04-27", recipients: [OTTO] },
    { date: null, recipients: [EULE] },
  ];
  const mailTo = (...names: string[]) => [{ label: COPY.admin.facts.mailTo, value: { record: formatList(names) } }];

  it.each([
    { day: "2027-04-20", named: ["Bieber", "Eule", "Otto Gruber"] },
    { day: "2027-04-21", named: ["Eule", "Otto Gruber"] },
  ])("names whom an exit from $day mails, each once", ({ day, named }) => {
    expect(exitFactsOf(entries, dayOf(day))).toStrictEqual(mailTo(...named));
  });

  it("names nobody where the exit mails nobody, or no day is typed", () => {
    expect(exitFactsOf([{ date: "2027-04-20", recipients: [BIEBER] }], dayOf("2027-04-21"))).toStrictEqual([]);
    expect(exitFactsOf(entries, null)).toStrictEqual([]);
  });
});
