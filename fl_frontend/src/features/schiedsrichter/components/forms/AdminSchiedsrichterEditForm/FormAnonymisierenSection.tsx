"use client";

import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { anonymiseSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import type { FLKontakt } from "@/shared/schemas";

/** What an empty field reads as in the armed readout — absent here, and possibly still in the log. */
const NOT_RECORDED = "Nicht hinterlegt";

/**
 * The referee's erasure, on `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`. **A
 * confirmation step and no undo**: one press deletes the row, repoints every fixture that named
 * them at the ghost, and empties every log row's pre-image.
 */
export function FormAnonymisierenSection({
  schiedsrichterId,
  name,
  schule,
  kontakt,
  onBeforeAnonymise,
}: {
  schiedsrichterId: string;
  /** `null` where a hand-write left the row nameless, so no sentence below may name a person outright. */
  name: string | null;
  /** The STORED school, for `kontakt`'s reason: the readout names what this press clears, not what is typed. */
  schule: string | null;
  /**
   * The STORED contact record, never the draft: this write clears what is saved. Read for the
   * readout alone — an emptied field is not an empty log, so an empty record still has work to do.
   */
  kontakt: FLKontakt;
  /**
   * Runs before the write; `false` cancels. The editor refuses while a draft is unsaved — the press
   * leaves this page at once, so an unsaved draft would go with no chance to save it.
   */
  onBeforeAnonymise: () => boolean;
}) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const twoPress = useTwoPressConfirm(onBeforeAnonymise);
  const { isConfirming, press } = twoPress;

  const panel = formPanel({ tone: "danger" });

  const handleAnonymise = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await anonymiseSchiedsrichterAction({ id: schiedsrichterId }).catch(unansweredAction);

      if (!res.success) {
        appToast.failure("Schiedsrichterdaten nicht gelöscht", res);
        return;
      }

      appToast.success("Schiedsrichterdaten gelöscht", { description: res.message });
      // `replace`, never `push`: this page is the erased referee's own and now answers not-found, so
      // Back must not return to it. The action's own revalidation is what refreshes the list.
      router.replace(saisonHref("/admin/schiedsrichter"));
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Daten löschen">
          {/* What is deleted and what survives it is the panel's own body below, and the danger panel
              with its two-press control is what says the press is final. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Löschen der Daten"
            body={{
              lead: "Der Weg, eine Person ganz aus der Verwaltung zu entfernen.",
              points: [{ term: "Die Felder oben zu leeren", text: "ist etwas anderes: Die alten Angaben bleiben im Änderungsprotokoll." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The row does not survive, so no sentence here may promise a reader anything they could open
            afterwards: what stays is the fixtures, and what they then show is the one word below. */}
        <p className="muted-hint">
          Das Löschen entfernt den Eintrag von <strong>{name ?? "dieser Person"}</strong> vollständig aus der Verwaltung. Auf jedem Spiel, das
          diese Person geleitet hat, steht danach nur noch „{SCHIEDSRICHTER_ANONYM_LABEL}“; die Spiele selbst bleiben mit Datum, Ergebnis und
          Honorar erhalten. Im Änderungsprotokoll wird der gesicherte Stand jeder Zeile gelöscht, die diese Person betrifft. Was wann geschehen
          ist, bleibt lesbar. Spiele ohne Ergebnis brauchen danach einen neuen Schiedsrichter. Zurückholen lässt sich das nicht.
        </p>

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                {/* The row says what a reader is shown afterwards as well as what goes: the fixtures
                    outlive the person, and the word standing on them is what somebody will meet. */}
                <ConfirmReadoutRow
                  label="Name"
                  value={name === null ? NOT_RECORDED : `${name}, danach nur „${SCHIEDSRICHTER_ANONYM_LABEL}“`}
                />
                {/* The school goes with the name: beside a fixture list that never expires it narrows the
                    person to the few referees one school ever sent. */}
                <ConfirmReadoutRow
                  label="Schule / Verein"
                  value={schule ?? NOT_RECORDED}
                />
                <ConfirmReadoutRow
                  label="E-Mail"
                  value={kontakt.email ?? NOT_RECORDED}
                />
                <ConfirmReadoutRow
                  label="Telefon"
                  value={kontakt.telefon ?? NOT_RECORDED}
                />
                {/* The log's own words for the pre-image it stores, so the readout names what the row
                    loses rather than a subset of it: the redaction clears the WHOLE stand. */}
                <ConfirmReadoutRow
                  label="Änderungsprotokoll"
                  value="Gesicherter Stand wird gelöscht"
                />
              </dl>
            </div>

            {/* No restore is named on purpose: nothing in the system holds the old values once the row
                and the log have both gone. What goes is the readout directly above. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Zurückholen lässt sich das nicht. Der Eintrag verschwindet ganz; die Spiele dieser Person bleiben bestehen und zeigen „
              {SCHIEDSRICHTER_ANONYM_LABEL}“.
            </p>

            {/* The one consequence the readout above cannot show: a match still to be played comes out of
                the press booked on a row nobody can officiate under. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Spiele ohne Ergebnis brauchen danach einen neuen Schiedsrichter.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow confirm={twoPress}>
          {/* The object stays in the label: on a danger panel under a trash icon, a bare „Ja, endgültig
              löschen“ would read as the referee going, where what goes is their data. */}
          <ConfirmPressButton
            confirm={twoPress}
            reason={null}
            resting="Daten löschen"
            armed="Ja, Daten endgültig löschen"
            running="Löscht..."
            icon={
              <TrashBin
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handleAnonymise}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
