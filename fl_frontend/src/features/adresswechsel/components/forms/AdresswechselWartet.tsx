"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { einladeAdresswechselAction, verwirfAdresswechselAction } from "@/features/adresswechsel/actions";
import { LinkStandAngaben, zeitpunktText } from "@/features/bewerbungen/components/ui/LinkStandAngaben";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";
import { meldeAdresswechselVersand } from "@/shared/utils/linkVersandToast";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { FLAdresswechselVerwaltungOffen, FLAdresswechselWartetAuf, FLAdresswechselWeg } from "@/features/adresswechsel/schemas";

export const ADRESSWECHSEL_ERNEUT = "Link erneut senden";
export const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";

/** How the change began, as the panel names it: the administrator reads off it who still has to act. */
const WEG_LABEL: Readonly<Record<FLAdresswechselWeg, string>> = {
  konto: "Im Konto angefragt",
  freigabe: "Freigabe durch die bisherige Adresse",
  wartezeit: "Ohne die bisherige Adresse",
};

/** The step the change waits on, as the read serves it and never derived here. */
const WARTET: Readonly<Record<FLAdresswechselWartetAuf, string>> = {
  freigabe: "Neue Adresse wartet auf Freigabe durch die bisherige",
  neue_adresse: "Neue Adresse wartet auf Bestätigung",
  genehmigung: "Neue Adresse wartet auf Genehmigung durch die Verwaltung",
  wartezeit: "Neue Adresse wartet auf das Ende der Wartezeit",
};

/** Unlike a re-send, a second discard of a change already gone is refused, so the page, read again, decides. */
const VERWERFEN_OHNE_ANTWORT =
  "Prüfe die Verbindung und zeige die Adresse erneut an. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.";

/**
 * The change standing at the address, **the address on file still in force**. Both writes name this change by its id,
 * so a page older than a newer change meets this one's end rather than acting on its successor. The re-send is
 * offered only while the new mailbox is asked: before an approval, or once confirmed, no link exists.
 */
export function AdresswechselWartet({ offen, onGeschrieben }: { offen: FLAdresswechselVerwaltungOffen; onGeschrieben: () => void }) {
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [laeuft, setLaeuft] = useState<"senden" | "verwerfen" | null>(null);
  const stepUp = useStepUp();
  const panel = formPanel();

  const schreibe = async (art: "senden" | "verwerfen") => {
    const landing = focusAfterWrite();
    const res = await pressLinkWrite<
      Awaited<ReturnType<typeof einladeAdresswechselAction>> | Awaited<ReturnType<typeof verwirfAdresswechselAction>>
    >({
      isDirty: false,
      stepUp,
      router,
      pending: (running) => setLaeuft(running ? art : null),
      write: art === "senden" ? () => einladeAdresswechselAction({ id: offen.id }) : () => verwirfAdresswechselAction({ id: offen.id }),
      repair: art === "senden" ? LINK_ERNEUT_OHNE_ANTWORT : VERWERFEN_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      if (art === "senden") appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      else appToast.failure("Änderung nicht verworfen", res);
      return;
    }

    landing.landed();
    onGeschrieben();
    // Graded as the start's press grades its link: the earlier link is dead whichever way this one went.
    if ("versand" in res) meldeAdresswechselVersand(res, res.message);
    else appToast.success("Änderung verworfen", { description: res.message });
  };

  const titel =
    offen.wartet_auf === "wartezeit" && offen.wirksam_ab !== null
      ? `Neue Adresse gilt ab ${zeitpunktText(offen.wirksam_ab)}`
      : WARTET[offen.wartet_auf];
  const { genehmigung } = offen;

  return (
    <section
      className={panel.root()}
      {...focusSection("adresswechsel")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Neue E-Mail-Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur neuen E-Mail-Adresse"
            body={{
              lead: "Die neue Adresse gilt erst, wenn sie über ihren Link bestätigt ist, nach einer Wartezeit erst an deren Ende. Bis dahin bleibt die bisherige Adresse in Kraft, und ihre Inhaberin oder ihr Inhaber kann die Änderung stoppen.",
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The lapse is the mark beside the deadline alone, as the consent link's panel says it. */}
        <p className="muted-hint">{titel}</p>

        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Neue Adresse">{offen.email}</Angabe>
          <Angabe label="Weg">{WEG_LABEL[offen.weg]}</Angabe>
          {offen.grund !== null && <Angabe label="Grund">{offen.grund}</Angabe>}
          {/* Only this step sent a link to the new mailbox: the request before it went to the address on file, and a
              confirmed change's link is spent. */}
          {offen.wartet_auf === "neue_adresse" && offen.gueltig_bis !== null && (
            <LinkStandAngaben
              verschicktAm={offen.verschickt_am}
              frist={offen.gueltig_bis}
              fristArt="zeitpunkt"
              istAbgelaufen={offen.abgelaufen}
              zustellung={offen.zustellung}
            />
          )}
          {offen.wartet_auf === "freigabe" && (
            <>
              <Angabe label="Anfrage gesendet am">{formatSpielDatum(offen.verschickt_am)}</Angabe>
              {offen.gueltig_bis !== null && <Angabe label="Freigabe bis">{zeitpunktText(offen.gueltig_bis)}</Angabe>}
            </>
          )}
          {offen.bestaetigt_am !== null && <Angabe label="Bestätigt am">{zeitpunktText(offen.bestaetigt_am)}</Angabe>}
          {offen.wirksam_ab !== null && <Angabe label="Wirksam ab">{zeitpunktText(offen.wirksam_ab)}</Angabe>}
          {genehmigung !== null && (
            <Angabe label="Genehmigung">
              {genehmigung.genehmigt_am === null ? (
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
                `Erteilt am ${zeitpunktText(genehmigung.genehmigt_am)}${genehmigung.genehmigt_von === null ? "" : ` von ${genehmigung.genehmigt_von}`}`
              )}
            </Angabe>
          )}
        </dl>

        <div className="flex w-full flex-wrap items-start gap-2">
          {offen.wartet_auf === "neue_adresse" && (
            <FocusSlot name="adresswechsel-einladen">
              <Button
                type="button"
                isPending={laeuft === "senden"}
                isDisabled={laeuft !== null}
                onPress={() => void schreibe("senden")}
                className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                <PaperPlane
                  className="size-3.5"
                  aria-hidden="true"
                />
                <span>{laeuft === "senden" ? stepUp.running("Sendet...") : ADRESSWECHSEL_ERNEUT}</span>
              </Button>
            </FocusSlot>
          )}
          <FocusSlot name="adresswechsel-verwerfen">
            <Button
              type="button"
              isPending={laeuft === "verwerfen"}
              isDisabled={laeuft !== null}
              onPress={() => void schreibe("verwerfen")}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <TrashBin
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{laeuft === "verwerfen" ? stepUp.running("Verwirft...") : ADRESSWECHSEL_VERWERFEN}</span>
            </Button>
          </FocusSlot>
        </div>
        <StepUpRefused refused={stepUp.refused} />
      </div>
    </section>
  );
}
