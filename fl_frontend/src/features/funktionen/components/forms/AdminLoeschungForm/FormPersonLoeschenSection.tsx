"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import PersonXmark from "@gravity-ui/icons/PersonXmark";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { eraseAufAnfrageAction, readErasureAnsichtAction } from "@/features/funktionen/actions";
import { FLErasurePayloadSchema } from "@/features/funktionen/schemas";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { ConfirmTypedAddress, useTypedAddressConfirm } from "@/shared/components/ui/ConfirmTypedAddress";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { skeletonBlock } from "@/shared/components/ui/skeleton";
import { TextField } from "@/shared/components/ui/TextField";
import { rejectedWrite, unansweredRead } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { FormLoeschungAnsicht } from "./FormLoeschungAnsicht";

import type { LoeschungAnsicht } from "./FormLoeschungAnsicht";

/** What the arming read left the reveal holding, carried WITH the address it was read for. */
type Gelesen = { adresse: string } & (
  { status: "reading" } | { status: "read"; ansicht: LoeschungAnsicht } | { status: "refused"; reason: string }
);

type Fehler = { email?: string; anlass?: string };

/** A refused read, said once for the reveal's body and the closed press alike, so the two cannot part. */
const ohneUebersicht = (reason: string): string =>
  `Die Übersicht, was gelöscht wird, konnte nicht geladen werden, und ohne sie wird nichts gelöscht. ${reason}`;

/** The repair where the read answered no sentence of its own: arming again is what reads the list a second time. */
const ERNEUT_STARTEN = "Brich ab und starte das Löschen erneut.";

/** Each box's verdict in the write's own words, judged at the press and never between keystrokes. */
function fehlerIn(email: string, anlass: string): Fehler {
  const geprueft = FLErasurePayloadSchema.safeParse({ email: email, anlass: anlass });
  if (geprueft.success) return {};

  const fehler: Fehler = {};
  for (const { path, message } of geprueft.error.issues) {
    const feld = path[0];
    if ((feld === "email" || feld === "anlass") && fehler[feld] === undefined) fehler[feld] = message;
  }
  return fehler;
}

/** The armed reveal's body, in the three states the read leaves it in. */
function AnsichtBody({ gelesen }: { gelesen: Gelesen | null }) {
  if (gelesen?.status === "read") return <FormLoeschungAnsicht ansicht={gelesen.ansicht} />;
  if (gelesen?.status === "refused") {
    return <p className="fluid-xxs leading-normal font-medium text-foreground">{ohneUebersicht(gelesen.reason)}</p>;
  }

  // The app's one „not yet here“ treatment: what arrives is a list, so what stands in for it is shaped like one.
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-y-2">
      <span className={`${skeletonBlock()} h-3 w-40 rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
    </div>
  );
}

/**
 * One person's erasure, keyed on the address they asked from (`docs/frontend/spec.md :: I685`, `:: I686`). In no
 * `<form>`: Enter in the retyped address would submit it.
 */
export function FormPersonLoeschenSection() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [anlass, setAnlass] = useState("");
  const [fehler, setFehler] = useState<Fehler>({});
  const [gelesen, setGelesen] = useState<Gelesen | null>(null);

  // What the confirmation compares against and the write sends: the address the arming read was made for. An edit
  // of the box disarms, so a reveal and a confirmation for one address are never pressed for another.
  const adresse = gelesen?.adresse ?? "";
  // The API holds the erasure of an address holding a grant to the enrolment's window: the step-up's alone would
  // meet its refusal, and the next press would ask nothing again.
  const haeltZugang = gelesen?.status === "read" && gelesen.ansicht.verwaltung !== null;
  const { confirm, field, reason } = useTypedAddressConfirm(adresse, { stepUp: haeltZugang ? "enrolment" : true });
  const { isConfirming, isPending } = confirm;

  const panel = formPanel({ tone: "danger" });

  const readAnsicht = async (gelesenFuer: string) => {
    setGelesen({ adresse: gelesenFuer, status: "reading" });

    // Settled, never awaited bare: outside a transition a rejected action leaves the placeholder up and the write
    // closed beneath it for good.
    const [settled] = await Promise.allSettled([readErasureAnsichtAction({ email: gelesenFuer })]);
    const res = settled.status === "rejected" ? unansweredRead() : settled.value;

    if (res.success) setGelesen({ adresse: gelesenFuer, status: "read", ansicht: res.ansicht });
    // A field map the press's own judgement let through points at no box the reveal shows.
    else setGelesen({ adresse: gelesenFuer, status: "refused", reason: res.fieldErrors === undefined ? res.error : ERNEUT_STARTEN });
  };

  const handlePress = () => {
    if (!isConfirming) {
      const gefunden = fehlerIn(email, anlass);
      setFehler(gefunden);
      if (gefunden.email !== undefined || gefunden.anlass !== undefined) return;

      // On the arming press and on no other: the read serves a person's records, so it is made when somebody asks
      // whom the address holds rather than as it is typed.
      void readAnsicht(email.trim());
    }

    const gesendet = { email: adresse, anlass: anlass };
    confirm.press(async () => {
      // A rejected action may still have erased, and uncaught here it takes the page down with it.
      const res = await eraseAufAnfrageAction(gesendet).catch(rejectedWrite(router));

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an `await` outside it.
      startTransition(() => {
        if (!res.success) {
          setFehler({ anlass: res.fieldErrors?.anlass });
          appToast.failure("Person nicht gelöscht", res);
          return;
        }

        // Emptied, so the press stands closed over them and its overlay keeps the focus the press had.
        setEmail("");
        setAnlass("");
        setGelesen(null);
        if (res.konto === "nichtGeloescht") appToast.warning("Konto nicht gelöscht", { description: res.message });
        // The endpoint refuses nothing, so an address holding nothing succeeds, and „gelöscht“ there would be a lie.
        else if (!res.gespeichert && res.konto === "keines") appToast.warning("Nichts gefunden", { description: res.message });
        else appToast.success("Person gelöscht", { description: res.message });
      });
    });
  };

  const ansicht = isConfirming && gelesen?.adresse === adresse ? gelesen : null;
  // The names ARE the confirmation, so a press taken over the placeholder would confirm nothing.
  const isReading = isConfirming && (ansicht === null || ansicht.status === "reading");
  // A refused read alone names a reason of its own: one still running ends by itself, as the write does.
  const ansichtReason = !isPending && ansicht?.status === "refused" ? ohneUebersicht(ansicht.reason) : null;
  const panelReason = email.trim() === "" ? "Gib zuerst die E-Mail-Adresse ein." : anlass.trim() === "" ? "Gib zuerst den Anlass ein." : null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Person löschen"
        />
      </div>

      <div className={panel.body()}>
        <TextField
          type="email"
          name="email"
          value={email}
          isDisabled={isPending}
          onChange={(next) => {
            setEmail(next);
            setFehler({ ...fehler, email: undefined });
            confirm.cancel();
          }}
          isInvalid={fehler.email !== undefined ? true : undefined}>
          <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
          {/* Off, so the address of somebody being erased is never kept in the browser's autofill store. */}
          <Input
            autoComplete="off"
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{fehler.email}</FieldError>
          <Hint
            mode="field"
            text="Die Adresse, unter der die Person um die Löschung gebeten hat."
          />
        </TextField>

        <TextField
          name="anlass"
          value={anlass}
          isDisabled={isPending}
          onChange={(next) => {
            setAnlass(next);
            setFehler({ ...fehler, anlass: undefined });
          }}
          isInvalid={fehler.anlass !== undefined ? true : undefined}>
          <Label className={FIELD_LABEL_CLASSES}>Anlass</Label>
          <Input
            autoComplete="off"
            placeholder="z.B. E-Mail vom 12.10.2026, Betreff „Löschung meiner Daten“"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{fehler.anlass}</FieldError>
          {/* Every log row the erasure files keeps it a year, past the redaction of anybody it names. */}
          <Hint
            mode="field"
            text="Datum und Betreff der Anfrage. Nenne hier keine Person beim Namen und keine Adresse. Der Anlass steht zwölf Monate im Änderungsprotokoll."
          />
        </TextField>

        {isConfirming && (
          <ConfirmReveal>
            <AnsichtBody gelesen={ansicht} />
            {ansicht?.status === "read" && <ConfirmTypedAddress field={field} />}
          </ConfirmReveal>
        )}

        <ConfirmActionRow confirm={confirm}>
          <ConfirmPressButton
            confirm={confirm}
            // The arming read holds the press without being the write: „Löscht...“ is said for the deletion alone.
            held={isReading}
            reason={ansichtReason ?? reason ?? panelReason}
            resting="Person löschen"
            // The object stays in the label: a bare „Ja, endgültig löschen“ reads as whatever the page is about.
            armed="Ja, Person endgültig löschen"
            running="Löscht..."
            icon={
              <PersonXmark
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handlePress}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
