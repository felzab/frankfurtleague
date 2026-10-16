"use client";

import { startTransition, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { KONTO_HREF } from "@/core/kontoHref";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import { BestaetigungAbschnitt, BestaetigungErgebnis, useLinkSeite, ZurLiga } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { rollenLangform } from "@/features/bewerbungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { StepUpContext } from "@/shared/components/ui/stepUp";
import { textLink } from "@/shared/components/ui/textLink";
import { useConfirmationWindows } from "@/shared/hooks/useConfirmationWindows";
import { usePasskeyStepUp } from "@/shared/hooks/usePasskeyStepUp";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { pruefeInhaberAction } from "../../actions";
import { loescheKontoAction } from "../../personActions";
import { LETZTE_INHABERIN } from "../../refusals";
import { registrierungTitel, schiedsrichterTitel, sitzTitel, SPIELER_TITEL } from "../forms/EinwilligungForm/kontoWorte";

import type { FLSelbstErasureAnsichtResponse } from "@/core/schemas";
import type { StepUp } from "@/shared/components/ui/stepUp";
import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";
import type { ReactNode } from "react";

/** Every record the erasure would reach, as the backend answered it, the transport's own field left behind. */
export type LoeschungAnsicht = Omit<FLSelbstErasureAnsichtResponse, "acknowledged">;

/**
 * What the page opens on. The token rides only where a press can spend it: a browser holding no session
 * completes nothing here, and is sent to sign in and open the link again (`docs/frontend/spec.md :: I677`).
 */
export type LoeschungStart =
  | { zustand: "bereit"; token: string; email: string; ansicht: LoeschungAnsicht }
  | { zustand: "anmelden" }
  | { zustand: "ohnePasskey" }
  | { zustand: "unvollstaendig" };

/**
 * A grant holder's windows as the page's render read them, with whose session that was: a confirmation
 * made once it has ended can sign another account in (`docs/frontend/spec.md :: I428`).
 */
export type GrantHolderStepUp = ConfirmedUntil & { readonly holderId: string };

type Stand = LoeschungStart | { zustand: "geloescht" };

const TITEL: Readonly<Record<Stand["zustand"], string>> = {
  bereit: "Konto löschen",
  anmelden: "Konto löschen",
  ohnePasskey: "Konto löschen",
  unvollstaendig: "Konto löschen",
  geloescht: "Konto gelöscht",
};

const LISTE_CLASSES = `${ABSATZ_CLASSES} flex list-disc flex-col gap-y-1 pl-5`;

const PROTOKOLL_ZEILE = "Deine Adresse im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen";

/** Each record in the words the account page heads it with, so the list names what its reader already knows there. */
function zeilenOf({ spieler, schiedsrichter, sitze, bewerbungen, registrierungen, adresswechsel, verwaltung }: LoeschungAnsicht): string[] {
  return [
    ...spieler.map(({ vorname, nachname }) => `${SPIELER_TITEL}: ${nachname === null ? vorname : `${vorname} ${nachname}`}`),
    ...schiedsrichter.map(({ name }) => (name === null ? "Als Schiedsrichterin oder Schiedsrichter" : schiedsrichterTitel({ name: name }))),
    ...sitze.map(({ rolle, team_name, saison_id }) => sitzTitel({ rollen: [rolle], team_name: team_name, saison_id: saison_id })),
    ...bewerbungen.map(({ rolle, saison_id }) => `Als ${rollenLangform([rolle])}: Bewerbung für die Saison ${saison_id}`),
    ...registrierungen.map(({ team_name, saison_id }) => registrierungTitel({ team_name: team_name, saison_id: saison_id })),
    ...(adresswechsel === 0
      ? []
      : [
          adresswechsel === 1
            ? "Eine noch nicht bestätigte Adressänderung auf Deine Adresse"
            : `${String(adresswechsel)} noch nicht bestätigte Adressänderungen auf Deine Adresse`,
        ]),
    ...(verwaltung === null ? [] : ["Dein Zugang zur Verwaltung"]),
  ];
}

/** The action a result panel offers, in the width the panel gives it. */
function Weiter({ href, children }: { href: string; children: string }) {
  return (
    <div className="flex w-full max-w-xs flex-col">
      <Link
        href={href}
        prefetch={false}
        className={ctaButton({ intent: "primary", hover: "css" })}>
        {children}
      </Link>
    </div>
  );
}

/** A person's figures: no window, and no holder for a prompt to check, since nothing here asks. */
const KEIN_FENSTER: GrantHolderStepUp = { freshUntil: null, enrolmentUntil: null, servedAt: 0, holderId: "" };

/**
 * The passkey prompt a grant holder's press asks through, built as the administrator's shell builds its
 * own (`fl_frontend/src/features/admin/components/providers/AdminStepUpProvider.tsx`) over the account
 * page's holder check, this page being the account's.
 */
function GrantHolderStepUpProvider({ served, children }: { served: GrantHolderStepUp | null; children: ReactNode }) {
  const windows = useConfirmationWindows(served ?? KEIN_FENSTER);

  const { holderId } = served ?? KEIN_FENSTER;
  const istInhaber = useCallback(async () => {
    const holder = await pruefeInhaberAction(holderId);
    return holder.success && holder.gleich;
  }, [holderId]);
  const { stepUp: prompt } = usePasskeyStepUp(istInhaber);

  // Memoised by hand: the React Compiler is deliberately off, and the armed press reads this.
  const stepUp = useMemo<StepUp>(
    () => ({
      isStale: windows.isStale,
      confirm: async () => {
        if (!(await prompt())) return false;

        // Wrapped: the press awaits this inside its transition, and React leaves an update after an
        // `await` outside it.
        startTransition(windows.confirmed);
        return true;
      },
    }),
    [windows, prompt],
  );

  // No page for a person's press, which then asks nothing (`fl_frontend/src/shared/hooks/useStepUp.ts`).
  return <StepUpContext.Provider value={served === null ? undefined : stepUp}>{children}</StepUpContext.Provider>;
}

/**
 * The interstitial a mailed deletion link opens: it restates what goes, and only a signed-in press destroys
 * it. `stepUp` is a grant holder's, whose press asks for the passkey first (`docs/frontend/spec.md :: I707`).
 */
export function LoeschungView({ start, stepUp = null }: { start: LoeschungStart; stepUp?: GrantHolderStepUp | null }) {
  // Mounted for a person too: the refresh after a grant holder's deletion renders no grant, and a provider
  // dropped there would remount the view, losing its answer.
  return (
    <GrantHolderStepUpProvider served={stepUp}>
      <LoeschungInhalt start={start} />
    </GrantHolderStepUpProvider>
  );
}

function LoeschungInhalt({ start }: { start: LoeschungStart }) {
  const router = useRouter();
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);
  // Asks only under the provider above: a person's press, holding no grant, is held to no window.
  const twoPress = useTwoPressConfirm({ stepUp: "enrolment" });

  const loesche = (token: string) => {
    twoPress.press(async () => {
      // A rejected action may still have deleted, and uncaught here it takes the page down with it.
      const res = await loescheKontoAction(token).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Konto nicht gelöscht", res);
        return;
      }

      beantwortet();
      setStand({ zustand: "geloescht" });
    });
  };

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>
      </header>

      {stand.zustand === "bereit" && (
        <BestaetigungAbschnitt titel="Was gelöscht wird">
          <ul className={LISTE_CLASSES}>
            <li>
              Dein Konto <Wert>{stand.email}</Wert> mit Deinen Passkeys und Anmeldungen
            </li>
            {zeilenOf(stand.ansicht).map((zeile, index) => (
              <li key={`${String(index)}-${zeile}`}>{zeile}</li>
            ))}
            {/* Named whatever the read found, as the administrator's reveal names it: no read lists the log's or the
                authorship's rewrite, which reaches an address holding no record too. */}
            <li>{PROTOKOLL_ZEILE}</li>
          </ul>
          <p className={ABSATZ_CLASSES}>
            <Wert>Zurückholen lässt sich das nicht.</Wert>
          </p>

          {/* No press the action would refuse: the last owner reads why, in the refusal's own words, and the link
              stays unspent for when another owner is made (`docs/frontend/spec.md :: I708`). */}
          {stand.ansicht.letzter_inhaber ? (
            <p className={ABSATZ_CLASSES}>{LETZTE_INHABERIN}</p>
          ) : (
            <>
              {twoPress.isConfirming && (
                <ConfirmReveal>
                  <p className="fluid-xxs leading-normal font-medium text-foreground">
                    Wir löschen Dein Konto und alles, was oben steht, sofort und endgültig.
                  </p>
                </ConfirmReveal>
              )}

              <ConfirmActionRow confirm={twoPress}>
                <ConfirmPressButton
                  confirm={twoPress}
                  reason={null}
                  resting="Konto endgültig löschen"
                  armed="Ja, Konto endgültig löschen"
                  running="Löscht..."
                  icon={
                    <TrashBin
                      className="size-4.5"
                      aria-hidden="true"
                    />
                  }
                  onPress={() => loesche(stand.token)}
                />
              </ConfirmActionRow>
            </>
          )}

          {/* The library spends a link it refuses, so the way on from any refusal is a fresh one. */}
          <p className="muted-hint">
            Lässt sich der Link nicht mehr verwenden, fordere auf Deiner{" "}
            <Link
              href={KONTO_HREF}
              prefetch={false}
              className={textLink()}>
              Kontoseite
            </Link>{" "}
            einen neuen an. Kommt keine E-Mail an, fordere ihn erneut an.
          </p>
        </BestaetigungAbschnitt>
      )}

      {stand.zustand === "anmelden" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Melde Dich zuerst an und öffne den Link aus der E-Mail danach erneut. Erst dann kannst Du die Löschung hier bestätigen.
          </p>
          <Weiter href="/signin">Zur Anmeldung</Weiter>
        </BestaetigungErgebnis>
      )}

      {/* The sign-in page offers a signed-in visitor its sign-out, and the next sign-in by code sends a granted
          address to set its passkey up (`fl_frontend/src/core/auth.ts :: destinationOf`). */}
      {stand.zustand === "ohnePasskey" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Mit Zugang zur Verwaltung bestätigst Du die Löschung mit Deinem Passkey, und Du hast noch keinen eingerichtet. Melde Dich ab und neu
            an, richte dabei Deinen Passkey ein und öffne dann den Link aus der E-Mail erneut.
          </p>
          <Weiter href="/signin">Zur Anmeldung</Weiter>
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unvollstaendig" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist unvollständig. Öffne ihn erneut aus der E-Mail, oder fordere auf Deiner Kontoseite einen neuen an.
          </p>
          <Weiter href={KONTO_HREF}>Zur Kontoseite</Weiter>
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "geloescht" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Dein Konto ist gelöscht, mit allen Angaben, die wir unter Deiner Adresse gespeichert hatten.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}
    </section>
  );
}
