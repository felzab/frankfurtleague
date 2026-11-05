"use client";

import { useId } from "react";

import { AccountBox } from "@/kit/AccountBox";
import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { Facts } from "@/kit/Facts";
import { RadioGroup } from "@/kit/RadioGroup";

import {
  SCHIEDSRICHTER_TEXT_VERSIONS,
  SCHIEDSRICHTER_WORDINGS,
  SEAT_TEXT_VERSIONS,
  SEAT_WORDINGS,
  SPIELER_TEXT_VERSIONS,
  SPIELER_WORDINGS,
} from "@/core/consentWordings";
import { COPY } from "@/core/copy";
import {
  saveBewerbungConsent,
  saveRegistrierungConsent,
  saveSchiedsrichterConsent,
  saveSeatConsent,
  saveSpielerConsent,
} from "@/features/konto/personActions";

import type { Copy, Words } from "@/core/copy";
import type { FLEinwilligungStand, FLEinwilligungUmfang, FLKontaktKenntnisnahmeUmfang } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

/**
 * Which write saves an entry, by the kind of record it is, and the ids naming the record. A pupil's, a registration's
 * and a referee's choose their name's scope; a seat's and an application's their contact scope.
 */
type Save =
  | { kind: "spieler" }
  | { kind: "registrierung"; registrierung_id: string }
  | { kind: "schiedsrichter"; schiedsrichter_id: string }
  | { kind: "seat"; team_id: string; saison_id: string }
  | { kind: "bewerbung"; bewerbung_id: string };

/** One record of the person's, as its box shows it: what it is, a team's seats titled by the team's own name, what the league stores, and its two choices. */
export type Entry = {
  readonly id: string;
  readonly title: Words;
  readonly description: Copy;
  readonly facts: readonly Fact[];
  readonly save: Save;
  /** The scope the record holds: a name's for a person's own record, a contact's for a seat. */
  readonly umfang: FLEinwilligungUmfang | FLKontaktKenntnisnahmeUmfang;
  readonly media: boolean;
  readonly evidence: FLEinwilligungStand;
  /** A grant may be given here; where not, the box takes withdrawals alone. */
  readonly givable: boolean;
  /** Why the media choice may not be given, its record short of the floor; `null` where it may. */
  readonly mediaFrom: Copy | null;
};

/** The fields a box posts: the scope, a choice or a box ticked, the media box, and the holder its act carries. */
const read = (formData: FormData) => ({
  umfang: formData.get("umfang"),
  media: formData.get("media") === "on",
  holder: String(formData.get("holder")),
});

/** A name's scope as its choice posts it, the record's own where the choice closed and posted none. */
const nameScope = (posted: FormDataEntryValue | null, held: Entry["umfang"]): FLEinwilligungUmfang =>
  posted === "kader_oeffentlich" || posted === "intern" ? posted : held === "kader_oeffentlich" ? "kader_oeffentlich" : "intern";

/** A contact's scope as its WhatsApp box posts it. */
const contactScope = (posted: FormDataEntryValue | null): FLKontaktKenntnisnahmeUmfang =>
  posted === "on" ? "kontaktdaten_whatsapp" : "kontaktdaten";

/**
 * The write saving an entry's choices, by the record's kind, with the labels its kind's words were shown under, read
 * off the one module the shown words come from, so a press names the text on screen.
 */
function saveOf(entry: Entry) {
  return (formData: FormData) => {
    const { umfang, media, holder } = read(formData);
    const { save, evidence } = entry;
    switch (save.kind) {
      case "spieler":
        return saveSpielerConsent({
          umfang: nameScope(umfang, entry.umfang),
          media,
          holder,
          evidence_state: evidence,
          text_versions: SPIELER_TEXT_VERSIONS,
        });
      case "registrierung":
        return saveRegistrierungConsent({
          registrierung_id: save.registrierung_id,
          umfang: nameScope(umfang, entry.umfang),
          media,
          holder,
          evidence_state: evidence,
          text_versions: SPIELER_TEXT_VERSIONS,
        });
      case "schiedsrichter":
        return saveSchiedsrichterConsent({
          schiedsrichter_id: save.schiedsrichter_id,
          umfang: nameScope(umfang, entry.umfang),
          media,
          holder,
          evidence_state: evidence,
          text_versions: SCHIEDSRICHTER_TEXT_VERSIONS,
        });
      case "seat":
        return saveSeatConsent({
          team_id: save.team_id,
          saison_id: save.saison_id,
          umfang: contactScope(umfang),
          media,
          holder,
          evidence_state: evidence,
          text_versions: SEAT_TEXT_VERSIONS,
        });
      case "bewerbung":
        return saveBewerbungConsent({
          bewerbung_id: save.bewerbung_id,
          umfang: contactScope(umfang),
          media,
          holder,
          evidence_state: evidence,
          text_versions: SEAT_TEXT_VERSIONS,
        });
    }
  };
}

/** The wordings an entry's kind shows, from the module its press's labels come from. */
const wordingsOf = (kind: Save["kind"]) =>
  kind === "spieler" || kind === "registrierung" ? SPIELER_WORDINGS : kind === "schiedsrichter" ? SCHIEDSRICHTER_WORDINGS : SEAT_WORDINGS;

/**
 * The scope's control under its wording, described by the line under it: a name's two options, the wider closed where
 * no grant may be given, or WhatsApp's box.
 */
function ScopeChoice({ entry }: { entry: Entry }) {
  const lineId = useId();
  const { kind } = entry.save;
  if (kind === "seat" || kind === "bewerbung") {
    const held = entry.umfang === "kontaktdaten_whatsapp";
    return (
      <>
        <Checkbox
          label={{ record: SEAT_WORDINGS.umfang.label }}
          aria-describedby={lineId}
          name="umfang"
          defaultSelected={held}
          isDisabled={!entry.givable && !held}
        />
        <ConsentLine
          id={lineId}
          line={SEAT_WORDINGS.umfang.line}
        />
      </>
    );
  }
  const wording = (kind === "schiedsrichter" ? SCHIEDSRICHTER_WORDINGS : SPIELER_WORDINGS).umfang;
  return (
    <>
      <RadioGroup
        label={{ record: wording.question }}
        aria-describedby={lineId}
        name="umfang"
        defaultValue={entry.umfang}
        choices={(["kader_oeffentlich", "intern"] as const).map((value) => ({
          id: value,
          label: { record: wording.options[value] },
          isDisabled: !entry.givable && value === "kader_oeffentlich" && entry.umfang !== value,
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
  const { media } = wordingsOf(entry.save.kind);
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
      act={{ run: saveOf(entry), carry: { holder }, button: { label: COPY.shared.verb.save }, saves: true }}>
      {entry.facts.length > 0 && (
        <Facts
          look="free"
          facts={entry.facts}
        />
      )}
      <ScopeChoice entry={entry} />
      <MediaChoice entry={entry} />
    </AccountBox>
  ));
}
