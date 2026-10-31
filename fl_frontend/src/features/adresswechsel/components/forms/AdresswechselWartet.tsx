"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { einladeAdresswechselAction, verwirfAdresswechselAction } from "@/features/adresswechsel/actions";
import { LinkStandAngaben, zeitpunktText } from "@/features/bewerbungen/components/ui/LinkStandAngaben";
import { Angabe } from "@/shared/components/ui/Angabe";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { LINK_UNKLAR, rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { FOCUS_HEADING, focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";
import { reportAddressChangeDispatch } from "@/shared/utils/linkDispatchToast";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { FLAddressChangeVerwaltungOpen, FLAddressChangeWaitsOn, FLAddressChangeWay } from "@/core/generated/client/types";

const ADRESSWECHSEL_ERNEUT = "Link erneut senden";
const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";
const ADRESSWECHSEL_VERWERFEN_ARMED = "Ja, Änderung verwerfen";

/** What the armed discard costs: nothing tells the person, so the administrator who discards is the one who can. */
const VERWERFEN_FOLGE =
  "Die Änderung endet, und ihre Links öffnen danach nichts mehr. Die bisherige Adresse bleibt. Eine E-Mail darüber bekommt niemand.";

/** How the change began, as the panel names it: the administrator reads off it who still has to act. */
const WEG_LABEL: Readonly<Record<FLAddressChangeWay, string>> = {
  account: "Im Konto angefragt",
  release: "Freigabe durch die bisherige Adresse",
  waiting_period: "Ohne die bisherige Adresse",
};

/** The step the change waits on, as the read serves it and never derived here. */
const WARTET: Readonly<Record<FLAddressChangeWaitsOn, string>> = {
  release: "Neue Adresse wartet auf Freigabe durch die bisherige",
  new_adresse: "Neue Adresse wartet auf Bestätigung",
  approval: "Neue Adresse wartet auf Genehmigung durch die Verwaltung",
  waiting_period: "Neue Adresse wartet auf das Ende der Wartezeit",
};

/**
 * The reload comes first, and this page holds what it showed in no address: a reload
 * opens on an empty box, so the address is shown again before anything is pressed again.
 */
const ERNEUT_OHNE_ANTWORT =
  "Prüfe die Verbindung, lade die Seite neu und zeige die bisherige Adresse erneut an. Wartet die neue Adresse dann noch, sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.";

/** Unlike a re-send, a second discard of a change already gone is refused, so the page, read again, decides. */
const VERWERFEN_OHNE_ANTWORT =
  "Prüfe die Verbindung, lade die Seite neu und zeige die bisherige Adresse erneut an. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.";

/**
 * The change at the address, **the address on file still in force**. Both writes name it by id: an older page meets
 * its end, never its successor. The re-send stands only while the new mailbox is asked.
 */
export function AdresswechselWartet({ offen, onGeschrieben }: { offen: FLAddressChangeVerwaltungOpen; onGeschrieben: () => void }) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [sendet, setSendet] = useState(false);
  const stepUp = useStepUp();
  // Two presses, as every neighbouring control ending something does: the discard ends the person's change and mails nobody.
  const verwerfen = useTwoPressConfirm({ stepUp: true });
  const busy = sendet || verwerfen.isPending;

  const sende = async () => {
    const landing = focusAfterWrite();
    const res = await pressLinkWrite({
      isDirty: false,
      stepUp,
      router,
      pending: setSendet,
      write: () => einladeAdresswechselAction({ id: offen.id }),
      repair: ERNEUT_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      return;
    }

    landing.landed();
    onGeschrieben();
    // Graded as the start's press grades its link: the mail leaves behind the answer, and the earlier link dies with it.
    reportAddressChangeDispatch(true, res.message);
  };

  const verwirf = () => {
    const landing = focusAfterWrite();
    verwerfen.press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await verwirfAdresswechselAction({ id: offen.id }).catch(rejectedWrite(router, VERWERFEN_OHNE_ANTWORT));

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an `await` outside it.
      startTransition(() => {
        if (!res.success) {
          appToast.failure("Änderung nicht verworfen", res);
          return;
        }

        landing.landed();
        onGeschrieben();
        appToast.success("Änderung verworfen", { description: res.message });
      });
    });
  };

  const titel =
    offen.waits_on === "waiting_period" && offen.effective_from !== null
      ? `Neue Adresse gilt ab ${zeitpunktText(offen.effective_from)}`
      : WARTET[offen.waits_on];
  const { approval: genehmigung } = offen;

  return (
    // A block of the tool's panel under an `h3`, as the read's list beside it: a box here would hold the discard's
    // reveal at its own rung.
    <section
      className="flex w-full flex-col gap-4"
      {...focusSection("adresswechsel")}>
      <div>
        <h3
          className={`${FORM_SECTION_HEADING_CLASSES} inline`}
          {...FOCUS_HEADING}>
          Neue E-Mail-Adresse
        </h3>
        <Hint
          mode="reveal"
          label="Hinweis zur neuen E-Mail-Adresse"
          body={{
            lead: "Die neue Adresse gilt erst, wenn sie über ihren Link bestätigt ist, nach einer Wartezeit erst an deren Ende. Bis dahin bleibt die bisherige Adresse in Kraft, und ihre Inhaberin oder ihr Inhaber kann die Änderung stoppen.",
          }}
        />
      </div>

      {/* The lapse is the mark beside the deadline alone, as the consent link's panel says it. */}
      <p className="muted-hint">{titel}</p>

      <dl className={FIELD_PAIR_CLASSES}>
        <Angabe label="Neue Adresse">{offen.email}</Angabe>
        <Angabe label="Weg">{WEG_LABEL[offen.way]}</Angabe>
        {offen.grund !== null && <Angabe label="Grund">{offen.grund}</Angabe>}
        {/* Only this step sent a link to the new mailbox: the request before it went to the address on file, and a
              confirmed change's link is spent. */}
        {offen.waits_on === "new_adresse" && offen.valid_until !== null && (
          <LinkStandAngaben
            verschicktAm={offen.sent_at}
            frist={offen.valid_until}
            fristArt="zeitpunkt"
            istAbgelaufen={offen.expired}
            zustellung={offen.delivery}
          />
        )}
        {offen.waits_on === "release" && (
          <>
            <Angabe label="Anfrage gesendet am">{formatSpielDatum(offen.sent_at)}</Angabe>
            {offen.valid_until !== null && <Angabe label="Freigabe bis">{zeitpunktText(offen.valid_until)}</Angabe>}
          </>
        )}
        {/* The address on file's own step, which the administrator reads off before trusting the new mailbox's. */}
        {offen.released_at !== null && <Angabe label="Freigegeben am">{zeitpunktText(offen.released_at)}</Angabe>}
        {offen.confirmed_at !== null && <Angabe label="Bestätigt am">{zeitpunktText(offen.confirmed_at)}</Angabe>}
        {offen.effective_from !== null && <Angabe label="Wirksam ab">{zeitpunktText(offen.effective_from)}</Angabe>}
        {genehmigung !== null && (
          <Angabe label="Genehmigung">
            {genehmigung.approved_at === null ? (
              <>
                Offen bis {zeitpunktText(genehmigung.bis)}.{" "}
                {/* Pressed on the grant's own row, where granting and revoking already are: one place for the approval. */}
                <Link
                  href={saisonHref("/bereich/admin/administratoren")}
                  prefetch={false}
                  className={textLink()}>
                  Zu den Administratoren
                </Link>
              </>
            ) : (
              `Erteilt am ${zeitpunktText(genehmigung.approved_at)}`
            )}
          </Angabe>
        )}
      </dl>

      {verwerfen.isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs leading-normal font-medium text-foreground">{VERWERFEN_FOLGE}</p>
        </ConfirmReveal>
      )}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {offen.waits_on === "new_adresse" && (
          <FocusSlot name="adresswechsel-einladen">
            <Button
              type="button"
              isPending={sendet}
              isDisabled={busy}
              onPress={() => void sende()}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <PaperPlane
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{sendet ? stepUp.running("Sendet...") : ADRESSWECHSEL_ERNEUT}</span>
            </Button>
          </FocusSlot>
        )}
        <ConfirmActionRow confirm={verwerfen}>
          <FocusSlot name="adresswechsel-verwerfen">
            <ConfirmPressButton
              confirm={verwerfen}
              reason={null}
              // Held while the re-send flies, which a discard would otherwise race over the one change.
              held={sendet}
              resting={ADRESSWECHSEL_VERWERFEN}
              armed={ADRESSWECHSEL_VERWERFEN_ARMED}
              running="Verwirft..."
              icon={
                <TrashBin
                  className="size-4.5"
                  aria-hidden="true"
                />
              }
              onPress={verwirf}
            />
          </FocusSlot>
        </ConfirmActionRow>
      </div>
      <StepUpRefused refused={stepUp.refused} />
    </section>
  );
}
