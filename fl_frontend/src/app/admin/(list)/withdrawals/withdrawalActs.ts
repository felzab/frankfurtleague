"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { identityPostWithdrawal } from "@/core/generated/client/sdk";
import { IdentityPostWithdrawalBody } from "@/core/generated/zod/inputs";

import type { Copy } from "@/core/copy";
import type { FLEinwilligungWithdrawalReport, FLWithdrawalChoice } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

const WORDS = ADMIN_COPY.withdrawal;

/** The choices in the boxes' order, each box posting under the choice's own name. */
const CHOICES = ["name", "whatsapp", "media"] as const satisfies readonly FLWithdrawalChoice[];

/** The kinds of record a fact's value can name, in the order it names them, each as the erasure's counts name it. */
const KINDS = [
  [COPY.shared.spieler, "spieler"],
  [COPY.shared.schiedsrichter, "schiedsrichter"],
  [ADMIN_COPY.erasure.count.teamSeats, "kontakt_seats"],
  [ADMIN_COPY.erasure.count.bewerbungSeats, "bewerbung_seats"],
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

/**
 * One row per choice the entry ends anywhere, labelled as its box is, with the kinds it ends on: a row per kind would
 * list choices, and the „und“ inside „Fotos und Videos“ would blur where one ends.
 */
const factsOf = (report: FLEinwilligungWithdrawalReport): Fact[] =>
  CHOICES.flatMap((choice) => {
    const kinds = KINDS.filter(([, kind]) => report[kind].includes(choice)).map(([label]) => label);
    return kinds.length === 0 ? [] : [{ label: WORDS.choice[choice], value: WORDS.ended(kinds) }];
  });

/**
 * What the entry would end at the address, by choice and kind and never by name, read from its dry run at the form's
 * press. No box ticked refuses before anything is read, and an address granting none of the ticked choices refuses with
 * no question.
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
