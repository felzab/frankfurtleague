"use client";

import { useId } from "react";

import { SCHIEDSRICHTER_WORDINGS, SEAT_WORDINGS, SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy/shared";
import { saveConsent } from "@/features/account/personActions";
import { AccountBox } from "@/kit/AccountBox";
import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { Facts } from "@/kit/Facts";
import { RadioGroup } from "@/kit/RadioGroup";

import type { Copy, Words } from "@/core/copy";
import type { FLEinwilligungScope, FLKontaktKenntnisnahmeScope } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

/**
 * The kind of record an entry is, which its save names. A pupil's, a registration's and a referee's choose their name's
 * scope; a seat's and an application's their contact scope.
 */
type Kind = "spieler" | "registrierung" | "schiedsrichter" | "seat" | "bewerbung";

/** One record of the person's, as its box shows it: what it is, a team's seats titled by the team's own name, what the league stores, and its two choices. */
export type Entry = {
  readonly id: string;
  readonly title: Words;
  readonly description: Copy;
  readonly facts: readonly Fact[];
  readonly kind: Kind;
  /**
   * What its save posts beside the two controls, unseen, by the names the save reads: the kind, the record's ids, the
   * evidence it was served and the labels its words are drawn under.
   */
  readonly carry: Readonly<Record<string, string>>;
  /** The scope the record holds: a name's for a person's own record, a contact's for a seat. */
  readonly scope: FLEinwilligungScope | FLKontaktKenntnisnahmeScope;
  readonly media: boolean;
  /** A grant may be given here; where not, the box takes withdrawals alone. */
  readonly givable: boolean;
  /** Why the media choice may not be given, its record short of the floor; `null` where it may. */
  readonly mediaFrom: Copy | null;
};

/** The wordings an entry's kind shows, from the module its press's labels come from. */
const wordingsOf = (kind: Kind) =>
  kind === "spieler" || kind === "registrierung" ? SPIELER_WORDINGS : kind === "schiedsrichter" ? SCHIEDSRICHTER_WORDINGS : SEAT_WORDINGS;

/**
 * The scope's control under its wording, described by the line under it: a name's two options, the wider closed where
 * no grant may be given, or WhatsApp's box.
 */
function ScopeChoice({ entry }: { entry: Entry }) {
  const lineId = useId();
  const { kind } = entry;
  if (kind === "seat" || kind === "bewerbung") {
    const held = entry.scope === "kontakt_data_whatsapp";
    return (
      <>
        <Checkbox
          label={{ record: SEAT_WORDINGS.scope.label }}
          aria-describedby={lineId}
          name="scope"
          defaultSelected={held}
          isDisabled={!entry.givable && !held}
        />
        <ConsentLine
          id={lineId}
          line={SEAT_WORDINGS.scope.line}
        />
      </>
    );
  }
  const wording = (kind === "schiedsrichter" ? SCHIEDSRICHTER_WORDINGS : SPIELER_WORDINGS).scope;
  return (
    <>
      <RadioGroup
        label={{ record: wording.question }}
        aria-describedby={lineId}
        name="scope"
        defaultValue={entry.scope}
        choices={(["kader_public", "internal"] as const).map((value) => ({
          id: value,
          label: { record: wording.options[value] },
          isDisabled: !entry.givable && value === "kader_public" && entry.scope !== value,
        }))}
      />
      <ConsentLine
        id={lineId}
        line={wording.line}
      />
    </>
  );
}

/** The media choice under its wording, described by the line under it. */
function MediaChoice({ entry }: { entry: Entry }) {
  const lineId = useId();
  const { media } = wordingsOf(entry.kind);
  return (
    <>
      <Checkbox
        label={{ record: media.label }}
        aria-describedby={lineId}
        name="media"
        defaultSelected={entry.media}
        isDisabled={(!entry.givable || entry.mediaFrom !== null) && !entry.media}
        description={entry.mediaFrom ?? undefined}
      />
      <ConsentLine
        id={lineId}
        line={media.line}
      />
    </>
  );
}

/**
 * Deine Einträge: every record of the person's own, one box each, with what the league stores of it and its two
 * choices under their wordings, saved together by the footer's „Speichern“ and by nothing else.
 */
export function EntriesBoxes({
  entries,
  holder,
}: {
  entries: readonly Entry[];
  /** The address the page is drawn for, which every save posts. */
  holder: string;
}) {
  return entries.map((entry) => (
    <AccountBox
      key={entry.id}
      title={entry.title}
      description={entry.description}
      act={{
        run: saveConsent,
        carry: { ...entry.carry, holder },
        button: { label: COPY.shared.verb.save, variant: "primary" },
        done: COPY.shared.toast.done.save,
      }}>
      <Facts
        look="free"
        facts={entry.facts}
      />
      <ScopeChoice entry={entry} />
      <MediaChoice entry={entry} />
    </AccountBox>
  ));
}
