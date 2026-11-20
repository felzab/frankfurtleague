"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { identityPostWithdrawal } from "@/core/generated/client/sdk";
import { IdentityPostWithdrawalBody } from "@/core/generated/zod/inputs";

import type { Copy } from "@/core/copy";
import type { FLEinwilligungWithdrawalReport, FLWithdrawalChoice } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

const WORDS = COPY.admin.withdrawal;

/** The choices in the boxes' order, each box posting under the choice's own name. */
const CHOICES = ["name", "whatsapp", "media"] as const satisfies readonly FLWithdrawalChoice[];

/** The rows the confirmation can show, in the order it shows them, each kind named as the erasure's counts name it. */
const KINDS = [
  [COPY.shared.spieler, "spieler"],
  [COPY.shared.schiedsrichter, "schiedsrichter"],
  [COPY.admin.erasure.count.teamSeats, "kontakt_seats"],
  [COPY.admin.erasure.count.bewerbungSeats, "bewerbung_seats"],
  [COPY.page.registrierungen, "registrierungen"],
] as const satisfies ReadonlyArray<readonly [Copy, keyof FLEinwilligungWithdrawalReport]>;

/** A box ticked posts its value, „on“ where it names none, and one left empty posts nothing. */
const ticked = z.literal("on").optional();

/** The form as it posts: the address and the three boxes, each under its own name, since a repeated name keeps its last value. */
const WithdrawalForm = z.object({
  email: IdentityPostWithdrawalBody.shape.email,
  name: ticked,
  whatsapp: ticked,
  media: ticked,
});

/** Only the kinds the entry ends something on, each with the choices it ends there. */
const factsOf = (report: FLEinwilligungWithdrawalReport): Fact[] =>
  KINDS.filter(([, kind]) => report[kind].length > 0).map(([label, kind]) => ({
    label,
    value: WORDS.ended(report[kind].map((choice) => WORDS.choice[choice])),
  }));

/**
 * What the entry would end at the address, by kind and never by name, read from its dry run at the form's press. No box
 * ticked refuses before anything is read, and an address granting none of the ticked choices refuses with no question.
 */
export const readWithdrawal = action({
  lane: "admin",
  name: "readWithdrawal",
  input: WithdrawalForm,
  ownWords: ["email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
  run: async (form) => {
    const choices = CHOICES.filter((choice) => form[choice] !== undefined);
    if (choices.length === 0) return { ok: false, reason: WORDS.noneChosen };
    const facts = factsOf(await identityPostWithdrawal({ email: form.email, choices }, { dry_run: true }));
    if (facts.length === 0) return { ok: false, reason: WORDS.nothingGranted };
    return {
      ok: true,
      value: { question: { subject: WORDS.object, consequence: WORDS.consequence, facts }, input: { email: form.email, choices } },
    };
  },
});

/**
 * Enters the withdrawal on every record the address holds, as the question asked. No passkey touch: a withdrawal only
 * withholds, and the touch guards a fixed list of acts it is not on.
 */
export const enterWithdrawal = action({
  lane: "admin",
  name: "enterWithdrawal",
  input: IdentityPostWithdrawalBody,
  ownWords: ["email_not_accepted"],
  paths: { email: "email" },
  examples: { email: COPY.shared.field.exampleAddress },
  run: async (entry) => {
    await identityPostWithdrawal(entry);
    return { ok: true, value: undefined, note: WORDS.entered };
  },
});
