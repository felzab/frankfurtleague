import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import type { FLOutboxStatus, FLSchiedsrichterSingleResponse } from "@/core/generated/client/types";
import type { ReactElement } from "react";
import type { SchiedsrichterEditor } from "./SchiedsrichterEditor";

const ID = "64b0000000000000000000a1";

const state = vi.hoisted(() => ({ read: null as unknown }));

/** An entry asked on 1 November and not yet answered, its last confirmation mail sent without trouble. */
const unanswered = (delivery: FLOutboxStatus | null): FLSchiedsrichterSingleResponse => ({
  schiedsrichter: {
    id: ID,
    name: "Mia Muster",
    schule: null,
    birth_date: null,
    default_payment: 20,
    kontakt: { email: "mia@example.org", phone: null },
    confirmation: { sent_at: "2026-11-01", deadline: "2026-11-15", declined_at: null },
    einwilligung: null,
    inactive_since: null,
    version: 2,
  },
  confirmation_expired: false,
  delivery,
});

/** The same entry once its person confirmed through the link. */
const confirmed = (delivery: FLOutboxStatus | null): FLSchiedsrichterSingleResponse => {
  const read = unanswered(delivery);
  return {
    ...read,
    schiedsrichter: {
      ...read.schiedsrichter,
      einwilligung: {
        confirmed_at: "2026-11-03",
        date: "2026-11-03",
        evidence: { media: null, scope: null },
        media: false,
        scope: "internal",
      },
    },
  };
};

const sent: FLOutboxStatus = { state: "sent", delivery: null, undeliverable: false };
const barred: FLOutboxStatus = { state: "barred", delivery: null, undeliverable: true };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

doubleApiClient(() => state.read);

const { default: SchiedsrichterEditorPage } = await import("./page");

/** The chips the editor sets after the referee's name. */
async function chipsFor(read: FLSchiedsrichterSingleResponse) {
  state.read = read;
  const shell = SchiedsrichterEditorPage({
    params: Promise.resolve({ schiedsrichter: ID }),
    searchParams: Promise.resolve({}),
  }) as ReactElement<{
    editor: Promise<ReactElement<Parameters<typeof SchiedsrichterEditor>[0]>>;
  }>;
  const { chip, flag } = (await shell.props.editor).props;
  return { chip, flag };
}

/* The confirmation mail's trouble is the one sign on the referee's page that the league's mails to them go unheard: a
   chip dropped or put in the state's place leaves the administrator reading the entry as reached. */
describe("the chips after a referee's name", () => {
  it("set the state's chip, then the mail's trouble", async () => {
    expect(await chipsFor(unanswered(barred))).toStrictEqual({
      chip: { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
      flag: { tone: "danger", label: COPY.admin.saison.addressBarred },
    });
  });

  it("set the state's chip alone where the mail met none", async () => {
    expect(await chipsFor(unanswered(sent))).toStrictEqual({
      chip: { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
      flag: undefined,
    });
    expect(await chipsFor(confirmed(null))).toStrictEqual({ chip: { tone: "success", label: COPY.admin.confirmed }, flag: undefined });
  });
});
