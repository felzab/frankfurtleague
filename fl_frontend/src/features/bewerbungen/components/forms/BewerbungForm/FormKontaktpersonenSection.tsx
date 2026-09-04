"use client";

import { useId } from "react";
import Link from "next/link";

import { FieldError, Input, Label, Switch, TextField } from "@heroui/react";

import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";
import { TrainerZugleichPicker } from "@/features/teams/components/forms/TrainerZugleichPicker";
import { KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_ERROR_SWITCH, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";

import type { BewerbungKontaktpersonDraft } from "@/features/bewerbungen/types";
import type { FLTrainerZugleich } from "@/features/teams/schemas";
import type { ReactNode } from "react";

export type SeatRolle = "ansprechperson" | "stellvertretung" | "trainer";

/**
 * What each seat is for, behind the heading's own glyph.
 *
 * **Spelled out per seat rather than looked up from `BEWERBUNG_SEATS`**: `hintCap.test.ts` counts a
 * body written as a literal, and an interpolated one is a hint nothing measures.
 */
const SEAT_HINT: Record<SeatRolle, ReactNode> = {
  trainer: (
    <Hint
      mode="reveal"
      label="Hinweis zur Trainerin oder zum Trainer"
      body={{ lead: "Wer das Team am Spieltag betreut und aufstellt." }}
    />
  ),
  ansprechperson: (
    <Hint
      mode="reveal"
      label="Hinweis zur Ansprechperson"
      body={{ lead: "Wen die Liga zuerst anruft, wenn es um Dein Team geht." }}
    />
  ),
  stellvertretung: (
    <Hint
      mode="reveal"
      label="Hinweis zur Stellvertretung"
      body={{ lead: "Wen die Liga erreicht, wenn die Ansprechperson gerade nicht kann." }}
    />
  ),
};

/**
 * One sentence per answer rather than the seat's label spliced into one: German inflects the article
 * with the noun, so a template reading correctly for these two need not for a label anybody adds.
 */
const ZUGLEICH_HINWEIS: Record<FLTrainerZugleich, string> = {
  ansprechperson: "Die Angaben der Ansprechperson gelten auch für die Trainerin oder den Trainer.",
  stellvertretung: "Die Angaben der Stellvertretung gelten auch für die Trainerin oder den Trainer.",
};

/**
 * The claim that fills the Trainer's seat is made on the Trainer's panel, last of the three, so it
 * points at a person the applicant has already typed rather than copying across an empty panel.
 */
export function FormKontaktpersonenSection({
  seat,
  label,
  person,
  zeigtAltersHinweis,
  trainerWahl,
  onTrainerWahl,
  onChange,
  onFieldLeft,
}: {
  seat: SeatRolle;
  label: string;
  person: BewerbungKontaktpersonDraft;
  /** The one place the sixteen-year rule is stated, so the caller decides which panel carries it. */
  zeigtAltersHinweis: boolean;
  /**
   * Which seat the Trainer IS. `undefined` on the two seats that carry no picker, and on the Trainer
   * panel while nobody has answered — the state the group renders with no chip pressed.
   */
  trainerWahl?: FLTrainerZugleich | null;
  /** Absent on the two seats the claim points AT, which is what makes this the Trainer's panel. */
  onTrainerWahl?: (seat: FLTrainerZugleich | null) => void;
  onChange: (next: BewerbungKontaktpersonDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  const altersHinweisId = useId();
  const emailHinweisId = useId();

  const path = (feld: string) => `kontakte.${seat}.${feld}`;

  /**
   * The wire spells an unanswered claim as `null`, so hiding the boxes until an answer would refuse
   * six fields on controls nobody can see — which reaches the applicant as the unhandled-path toast.
   */
  const zeigtFelder = trainerWahl === undefined || trainerWahl === null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={label}>
          {SEAT_HINT[seat]}
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {onTrainerWahl !== undefined && (
          <TrainerZugleichPicker
            value={trainerWahl}
            onPick={onTrainerWahl}
          />
        )}

        {zeigtAltersHinweis && (
          <Hint
            mode="inline"
            describes={altersHinweisId}
            text="Kontaktperson kann sein, wer mindestens 16 ist."
          />
        )}

        {/* In the boxes' place rather than beside them: the claim names a person entered above, and a
            read-only copy of their details here would read as a fourth person. */}
        {trainerWahl !== undefined && trainerWahl !== null && <p className="muted-hint">{ZUGLEICH_HINWEIS[trainerWahl]}</p>}

        {zeigtFelder && (
          <>
            <div className={FIELD_PAIR}>
              <TextField
                isRequired
                aria-describedby={zeigtAltersHinweis ? altersHinweisId : undefined}
                name={path("vorname")}
                value={person.vorname}
                onChange={(next) => onChange({ ...person, vorname: next })}
                onBlur={() => onFieldLeft([path("vorname")])}
                maxLength={KONTAKT_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL}>Vorname</Label>
                <Input className={FIELD_INPUT} />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              <TextField
                isRequired
                name={path("nachname")}
                value={person.nachname}
                onChange={(next) => onChange({ ...person, nachname: next })}
                onBlur={() => onFieldLeft([path("nachname")])}
                maxLength={KONTAKT_NAME_MAX_LENGTH}>
                <Label className={FIELD_LABEL}>Nachname</Label>
                <Input className={FIELD_INPUT} />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            <div className={FIELD_PAIR}>
              {/* The hint rides in the same grid cell as the box it explains, so it stays under that
                  box rather than under whichever field the two-column layout puts beside it. */}
              <div className="flex w-full flex-col gap-y-1">
                <TextField
                  isRequired
                  type="email"
                  aria-describedby={emailHinweisId}
                  name={path("email")}
                  value={person.email}
                  onChange={(next) => onChange({ ...person, email: next })}
                  onBlur={() => onFieldLeft([path("email")])}>
                  <Label className={FIELD_LABEL}>E-Mail</Label>
                  <Input
                    placeholder="z.B. name@beispiel.de"
                    className={FIELD_INPUT}
                  />
                  <FieldError className={FIELD_ERROR} />
                </TextField>
                <Hint
                  mode="inline"
                  describes={emailHinweisId}
                  text="An diese Adresse schicken wir den Link zur Bestätigung. Dort trägt die Person auch ihr Geburtsdatum ein."
                />
              </div>

              <TextField
                isRequired
                type="tel"
                name={path("telefon")}
                value={person.telefon}
                onChange={(next) => onChange({ ...person, telefon: next })}
                onBlur={() => onFieldLeft([path("telefon")])}>
                <Label className={FIELD_LABEL}>Telefon</Label>
                <Input
                  placeholder="z.B. 069 1234567"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The privacy notice, linked on its own name wherever the retained wording happens to use it. */
const DATENSCHUTZ_WORT = "Datenschutzerklärung";

function mitDatenschutzLink(absatz: string): ReactNode {
  const [vor = "", ...rest] = absatz.split(DATENSCHUTZ_WORT);
  if (rest.length === 0) return absatz;

  return (
    <>
      {vor}
      <Link
        href="/datenschutz"
        prefetch={false}
        className={textLink()}>
        {DATENSCHUTZ_WORT}
      </Link>
      {rest.join(DATENSCHUTZ_WORT)}
    </>
  );
}

/**
 * **One switch and not three**: it asserts that the three people know of their entry, where three
 * consents would claim what two absent people cannot give. Each person's consent comes through their
 * own link.
 */
export function FormEinwilligungSection({
  erteilt,
  onErteiltPicked,
}: {
  erteilt: boolean;
  /** A press, so it is judged here rather than on a blur no switch produces. */
  onErteiltPicked: (erteilt: boolean) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        {/* The heading level follows the frame: this is a section of the form like the five around
            it, so it is announced at the level they are rather than as a group inside one of them. */}
        <PanelHeading
          className={panel.heading()}
          title="Bestätigung"
        />
      </div>

      <div className={panel.body()}>
        {/* `muted-meta` rather than `muted-hint`: the wording is stamped and cannot be shortened, so
            the type step it is set at is the only lever on how long the block reads. */}
        {LIGA_EINWILLIGUNG.absaetze.map((absatz) => (
          <p
            key={absatz}
            className="muted-meta">
            {mitDatenschutzLink(absatz)}
          </p>
        ))}

        {/* The Switch holds the NAME itself: `SwitchField` takes one, so its own checkbox carries
            `aria-required` and `aria-invalid` and is described by the message below it. */}
        <Switch
          className="flex w-full flex-col gap-y-1"
          // The Ansprechperson's path stands for all three: one press writes every seat's `erteilt`,
          // so the schema can never refuse one of them alone.
          name="kontakte.ansprechperson.einwilligung.erteilt"
          isRequired
          isSelected={erteilt}
          onChange={onErteiltPicked}>
          <Switch.Content className={panel.switchContent()}>
            {LIGA_EINWILLIGUNG.schalter}
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
          <FieldError className={FIELD_ERROR_SWITCH} />
        </Switch>
      </div>
    </section>
  );
}
