import { createHash } from "node:crypto";

import { parseDate } from "@internationalized/date";

import { now } from "@/core/clock";
import { COPY, textOf } from "@/core/copy";
import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";
import { dayIn } from "@/core/format";

import type { Copy, Words } from "@/core/copy";
import type { FLActionLogFilterPayload, FLActionType } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

const WORDS = COPY.admin.actionLog;

/** What „Art“ offers, in the rail's order. */
const TYPES = {
  saison: COPY.page.adminSaisons,
  spiel: COPY.page.spiele,
  spielort: COPY.page.adminSpielorte,
  schiedsrichter: COPY.shared.schiedsrichter,
  bewerbung: COPY.page.adminBewerbungen,
  team: COPY.page.teams,
  spieler: COPY.shared.spieler,
  registrierung: COPY.page.registrierungen,
  grant: COPY.page.adminAdministrators,
  ban: COPY.page.adminBanList,
  erasure: COPY.page.adminErasures,
  address_change: COPY.page.adminAddressChanges,
} satisfies Partial<Record<FLActionType, Copy>>;

export type ActionTypeChoice = keyof typeof TYPES;

/**
 * The „Art“ option each published category reads under, so a category the API adds fails `tsc` here rather than
 * falling out of every option. „Art: Löschungen“ holds a person's or an administrator's deletion and a pass's alike.
 */
const CHOICE_OF: Record<FLActionType, ActionTypeChoice> = {
  saison: "saison",
  spieltag: "spiel",
  spiel: "spiel",
  spielbestaetigung: "spiel",
  spielbericht: "spiel",
  team: "team",
  bewerbung: "bewerbung",
  registrierung: "registrierung",
  spieler: "spieler",
  schiedsrichter: "schiedsrichter",
  spielort: "spielort",
  grant: "grant",
  ban: "ban",
  address_change: "address_change",
  erasure: "erasure",
  retention: "erasure",
};

export const TYPE_CHOICES = Object.keys(TYPES) as [ActionTypeChoice, ...ActionTypeChoice[]];

export const TYPE_OPTIONS = TYPE_CHOICES.map((id) => ({ id, label: TYPES[id] }));

/** „Zeitraum“'s presets, each how far before today it reaches. */
const PERIODS = {
  "7-days": { label: WORDS.time.days(7), span: { days: 7 } },
  "30-days": { label: WORDS.time.days(30), span: { days: 30 } },
  "12-months": { label: WORDS.time.months(12), span: { months: 12 } },
};

export type PeriodChoice = keyof typeof PERIODS;

export const PERIOD_CHOICES = Object.keys(PERIODS) as [PeriodChoice, ...PeriodChoice[]];

export const PERIOD_OPTIONS = PERIOD_CHOICES.map((id) => ({ id, label: PERIODS[id].label }));

/** What `by` holds where it holds no administrator's address. */
const ROLE_WORDS: ReadonlyMap<string, Copy> = new Map([
  ["kontakt", COPY.page.teams],
  ["schiedsrichter", COPY.shared.schiedsrichter],
  ["system", WORDS.automatic],
  ["person", COPY.admin.spieler.person],
  [ERASED_ACTOR_MARKER, COPY.admin.erasedActor],
]);

/** Who `by` names: a role's word, an erased person's, or an administrator's own address. */
export const actorWords = (by: string): Words => ROLE_WORDS.get(by) ?? { record: by };

/**
 * A „Wer“ option's id, opaque because it stands in the page's URL, which the edge's log, the next page's referer and
 * Cloudflare's log keep, and an address reaches none of them. A digest rather than a position, so a shared link goes on
 * naming the same actor as the log grows.
 */
const optionId = (by: string) => createHash("sha256").update(by).digest("hex").slice(0, 16);

/** What „Wer“ offers: every `by` the log holds, by what it reads. */
export function byOptions(held: readonly string[]): readonly Option[] {
  return held
    .map((by) => ({ id: optionId(by), label: actorWords(by) }))
    .sort(({ label: one }, { label: other }) => textOf(one).localeCompare(textOf(other), "de"));
}

/** The `by` a „Wer“ option stands for, read back on the server from what the log holds. */
export const byOf = (held: readonly string[], id: string | null) => held.find((by) => optionId(by) === id) ?? null;

/** The filters a read narrows by, none where it names none. */
export type ChosenFilters = { by?: string | null; type?: ActionTypeChoice | null; time?: PeriodChoice | null };

/**
 * The filters as the read asks them: one „Art“ may stand for several categories, and a preset is the German
 * day it reaches back to, counted from the day it is read.
 */
export function logParams({ by = null, type = null, time = null }: ChosenFilters): FLActionLogFilterPayload {
  return {
    by,
    type: type === null ? null : (Object.keys(CHOICE_OF) as FLActionType[]).filter((category) => CHOICE_OF[category] === type),
    from_day: time === null ? null : parseDate(dayIn(now())).subtract(PERIODS[time].span).toString(),
  };
}
