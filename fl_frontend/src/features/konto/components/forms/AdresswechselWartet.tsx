"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";

import { LinkStandAngaben, zeitpunktText } from "@/features/bewerbungen/components/ui/LinkStandAngaben";
import { Angabe } from "@/shared/components/ui/Angabe";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, LINK_UNKLAR } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { meldeAdresswechselVersand } from "@/shared/utils/linkVersandToast";
import { pressLinkWrite } from "@/shared/utils/linkWrite";

import type { FLSpielerAdresswechsel } from "@/features/spieler/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { HinweisVersand, LinkVersand } from "@/shared/utils/linkVersand";

export const ADRESSWECHSEL_WARTET = "Neue Adresse wartet auf Bestätigung";
export const ADRESSWECHSEL_ERNEUT = "Link erneut senden";
export const ADRESSWECHSEL_VERWERFEN = "Änderung verwerfen";

/** How the change began, as the panel names it: the administrator reads off it who still has to act. */
const WEG_LABEL: Readonly<Record<FLSpielerAdresswechsel["weg"], string>> = {
  konto: "Im Konto angefragt",
  freigabe: "Freigabe durch die bisherige Adresse",
  wartezeit: "Ohne die bisherige Adresse",
};

/** Unlike a re-send, a second discard of a change already gone is refused, so the page, reloaded, decides. */
const VERWERFEN_OHNE_ANTWORT = "Prüfe die Verbindung und lade die Seite neu. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.";

type Einladen = () => Promise<ActionResult<{ versand: LinkVersand | null; hinweis: HinweisVersand | null }>>;
type Verwerfen = () => Promise<ActionResult>;

/** Which step the change waits on, read off the block: no read model serves its hashes. */
function stufeOf(wechsel: FLSpielerAdresswechsel): "freigabe" | "neue_adresse" | "wartezeit" {
  if (wechsel.bestaetigt_am !== null) return "wartezeit";
  return wechsel.weg === "freigabe" && wechsel.freigegeben_am === null ? "freigabe" : "neue_adresse";
}

/**
 * Shown only while a change is pending, both lanes' editors alike. **The address above is still in
 * force**, which this panel says beside the controls ending the wait. The re-send is offered only while
 * the new mailbox is asked: a change awaiting its approval, or confirmed and waiting, has no link to send.
 */
export function AdresswechselWartet({
  adresswechsel,
  istAbgelaufen,
  isDirty,
  erneutName,
  einladen,
  verwerfen,
}: {
  adresswechsel: FLSpielerAdresswechsel;
  /** The read's judgement of the deadline: a lapsed change stands until the pass removes it, so the instant alone reads as running. */
  istAbgelaufen: boolean;
  /** The editor's unsaved typing, which either write re-keys the editor over. */
  isDirty: boolean;
  /** The re-send's accessible name where the page holds another „Link erneut senden“ for another link. */
  erneutName?: string;
  einladen: Einladen;
  verwerfen: Verwerfen;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<"senden" | "verwerfen" | null>(null);
  const stepUp = useStepUp();
  const panel = formPanel();
  const stufe = stufeOf(adresswechsel);

  // Both writes mint or void a link to an address.
  const schreibe = async (art: "senden" | "verwerfen") => {
    const landing = focusAfterWrite();
    const res = await pressLinkWrite<Awaited<ReturnType<Einladen>> | Awaited<ReturnType<Verwerfen>>>({
      isDirty,
      stepUp,
      router,
      pending: (running) => setLaeuft(running ? art : null),
      write: art === "senden" ? einladen : verwerfen,
      repair: art === "senden" ? LINK_ERNEUT_OHNE_ANTWORT : VERWERFEN_OHNE_ANTWORT,
    });
    if (res === null) return;

    if (!res.success) {
      if (art === "senden") appToast.failure("Link nicht gesendet", res, LINK_UNKLAR);
      else appToast.failure("Änderung nicht verworfen", res);
      return;
    }

    landing.landed();
    // Graded as the start's press grades its link: the earlier link is dead whichever way this one went.
    if ("versand" in res) meldeAdresswechselVersand(res, res.message);
    else appToast.success("Änderung verworfen", { description: res.message });
  };

  const titel =
    stufe === "freigabe"
      ? "Neue Adresse wartet auf Freigabe"
      : stufe === "wartezeit" && adresswechsel.wirksam_ab !== null
        ? `Neue Adresse gilt ab ${zeitpunktText(adresswechsel.wirksam_ab)}`
        : ADRESSWECHSEL_WARTET;

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
              lead: "Die neue Adresse gilt erst, wenn sie über ihren Link bestätigt ist, nach einer Wartezeit erst an deren Ende. Bis dahin bleibt die Adresse oben in Kraft, und ihre Inhaberin oder ihr Inhaber kann die Änderung stoppen.",
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The lapse is the mark beside the deadline alone, as the consent link's panel says it. */}
        <p className="muted-hint">{titel}</p>

        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Neue Adresse">{adresswechsel.email}</Angabe>
          <Angabe label="Weg">{WEG_LABEL[adresswechsel.weg]}</Angabe>
          {adresswechsel.grund !== null && <Angabe label="Grund">{adresswechsel.grund}</Angabe>}
          {stufe === "wartezeit"
            ? adresswechsel.wirksam_ab !== null && <Angabe label="Wirksam ab">{zeitpunktText(adresswechsel.wirksam_ab)}</Angabe>
            : adresswechsel.gueltig_bis !== null && (
                <LinkStandAngaben
                  verschicktAm={adresswechsel.verschickt_am}
                  frist={adresswechsel.gueltig_bis}
                  fristArt="zeitpunkt"
                  istAbgelaufen={istAbgelaufen}
                  zustellung={adresswechsel.zustellung}
                />
              )}
        </dl>

        <div className="flex w-full flex-wrap items-start gap-2">
          {stufe === "neue_adresse" && (
            <FocusSlot name="adresswechsel-einladen">
              <Button
                type="button"
                aria-label={erneutName}
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
