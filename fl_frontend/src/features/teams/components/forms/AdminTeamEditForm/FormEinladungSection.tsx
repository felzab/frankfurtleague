"use client";

import { startTransition, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import Ban from "@gravity-ui/icons/Ban";
import Copy from "@gravity-ui/icons/Copy";
import Envelope from "@gravity-ui/icons/Envelope";
import Link from "@gravity-ui/icons/Link";

import { Button } from "@heroui/react/button";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { deleteEinladungAction, mailEinladungAction, postEinladungAction } from "@/features/einladungen/actions";
import { useEinladungLink } from "@/features/einladungen/components/EinladungLinkHolder";
import { STUFE_CHIP_CLASSES } from "@/features/saisons/components/forms/StufenPicker";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_TEXTAREA_CLASSES, FORM_SECTION_HEADING_CLASSES, TOGGLE_GROUP_ALIGN_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FrischeEinladung } from "@/features/einladungen/components/EinladungLinkHolder";
import type { FLEinladung } from "@/features/einladungen/schemas";
import type { Key } from "@heroui/react/rac";

/**
 * **The one sentence that has to survive every rewrite of this panel**: the store keeps a hash, so
 * the value an administrator can copy or mail exists only until this page is left.
 */
const LINK_NUR_JETZT = "Der Link selbst wird nicht gespeichert. Lege einen neuen Link an, wenn Du ihn weitergeben willst.";

/** A mint of unknown outcome: its token went with the answer and no read serves it back, so the repair is the row a reload shows. */
const MINT_UNKLAR = "Lade die Seite neu. Steht dort ein Link, ziehe ihn zurück und erstelle einen neuen.";

/** Where a reader goes when the browser refuses the clipboard, beside the box the value stands in. */
const VON_HAND_KOPIEREN = "Markiere den Link im Feld darüber und kopiere ihn von Hand.";

/** Which of the two writes the armed press performs, picked before arming rather than raced between two controls. */
type Operation = "ersetzen" | "zurueckziehen";

/**
 * The team's registration link for one season, on `POST`, `DELETE` and `GET
 * /teams/{team_id}/saisons/{saison_id}/einladung`. **Minting and mailing are two presses, and no
 * contact seat reaches either**: both are an administrator's.
 */
export function FormEinladungSection({
  teamId,
  saisonId,
  isMember,
  isFinishedSaison,
  einladung,
  laeuft,
}: {
  teamId: string;
  saisonId: string;
  /** `REQ-EINLADUNG-001` in the form: a link belongs to a junction row, so a club outside the season has none. */
  isMember: boolean;
  /** `REQ-EINLADUNG-002`: a finished season hands out no further links, and the panel explains instead of offering. */
  isFinishedSaison: boolean;
  einladung: FLEinladung | null;
  /** Whether the registration window is open today, which is the link's only expiry. */
  laeuft: boolean;
}) {
  // Held outside this panel's own subtree, which the editor re-keys on every stored value a save
  // moves (`fl_frontend/src/features/einladungen/components/EinladungLinkHolder.tsx`).
  const { frisch, setFrisch } = useEinladungLink();
  const [gewaehlt, setGewaehlt] = useState<Operation | null>(null);
  // Its own transition beside the shared hook, for the FIRST mint alone: that press destroys
  // nothing, so escalating it would grade a create as a loss.
  const [isMinting, startMinting] = useTransition();
  const [isMailing, startMailing] = useTransition();

  const twoPress = useTwoPressConfirm();
  const router = useRouter();
  const { isConfirming, isPending: isWriting, press, cancel } = twoPress;

  const panel = formPanel();
  const busy = isMinting || isMailing || isWriting;

  const mint = async () => {
    // A rejected action may still have saved, and uncaught here it takes the page down with it.
    const res = await postEinladungAction({ team_id: teamId, saison_id: saisonId }).catch(rejectedWrite(router));

    if (!res.success) {
      appToast.failure("Registrierungslink nicht angelegt", res.outcome === "unknown" ? { ...res, error: MINT_UNKLAR } : res);
      return;
    }

    // Wrapped again: both callers run this inside a transition, and React leaves an update after an
    // `await` outside it.
    startTransition(() => {
      setFrisch({ einladungId: res.einladung_id, token: res.token, link: res.link });
      appToast.success("Registrierungslink angelegt", { description: res.message });
    });
  };

  const widerrufen = async () => {
    // A rejected action may still have saved, and uncaught here it takes the page down with it.
    const res = await deleteEinladungAction({ team_id: teamId, saison_id: saisonId }).catch(rejectedWrite(router));

    if (!res.success) {
      appToast.failure("Link nicht zurückgezogen", res);
      return;
    }

    // Wrapped again: the press runs this inside its transition, and React leaves an update after an
    // `await` outside it.
    startTransition(() => {
      setFrisch(null);
      appToast.success("Link zurückgezogen", { description: res.message });
    });
  };

  const handlePress = () => {
    // Ahead of `press`, so an unpicked operation neither arms nor writes.
    if (gewaehlt === null) return;

    press(async () => {
      await (gewaehlt === "ersetzen" ? mint() : widerrufen());
      // Wrapped again: the press runs this inside its transition, and React leaves an update after an
      // `await` outside it.
      startTransition(() => {
        // Cleared with the write that consumed it: a choice left standing would preselect itself the
        // next time both acts are open.
        setGewaehlt(null);
      });
    });
  };

  const versenden = (offen: FrischeEinladung) => {
    startMailing(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await mailEinladungAction({
        team_id: teamId,
        saison_id: saisonId,
        einladung_id: offen.einladungId,
        token: offen.token,
      }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Registrierungslink nicht gesendet", res);
        return;
      }

      appToast.success("Registrierungslink gesendet", { description: res.message });
    });
  };

  const kopieren = (offen: FrischeEinladung) => {
    void copyTextToClipboard(offen.link).then((copied) =>
      copied
        ? appToast.success("Link kopiert", { description: "Der Link liegt in der Zwischenablage." })
        : appToast.danger("Link nicht kopiert", { description: CLIPBOARD_ERROR_DETAIL }),
    );
  };

  const zustellung = einladung?.versand?.zustellung ?? null;
  const versandText = zustellung === null ? "Noch nicht gesendet" : (ZUSTELLUNG_CHIP[zustellung.stand]?.label ?? "Gesendet");

  const restingLabel = gewaehlt === "zurueckziehen" ? "Link zurückziehen" : "Neuen Link anlegen";
  const armedLabel = gewaehlt === "zurueckziehen" ? "Ja, Link zurückziehen" : "Ja, neuen Link anlegen";

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Registrierungslink">
          <Hint
            mode="reveal"
            label="Hinweis zum Registrierungslink"
            body={{
              lead: "Über diesen Link registrieren sich die Spielerinnen und Spieler dieses Teams für die Saison.",
              points: [
                { term: "Jede Registrierung über den Link", text: "wartet auf die Aufnahme in den Kader durch das Team." },
                { term: "Der Link", text: "gilt, solange die Registrierung für diese Saison geöffnet ist." },
                { term: "Ein neuer Link", text: "beendet den bisherigen." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {!isMember ? (
          <Callout
            severity="info"
            title="Einen Registrierungslink bekommt nur ein Team, das in dieser Saison steht">
            Nimm das Team oben unter „Saison“ auf.
          </Callout>
        ) : (
          <>
            {isFinishedSaison && (
              <Callout
                severity="info"
                title="Für eine abgeschlossene Saison werden keine Registrierungslinks mehr ausgegeben"
              />
            )}

            {!isFinishedSaison && !laeuft && (
              <Callout
                severity="warning"
                title="Die Registrierung für diese Saison ist gerade nicht geöffnet">
                Ein Link lässt sich trotzdem anlegen; er öffnet die Registrierung erst, wenn das Fenster läuft.
              </Callout>
            )}

            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Stand</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="Offener Link"
                  value={einladung === null ? "Keiner" : `seit ${formatSpielDatum(einladung.erstellt_am)}`}
                />
                {einladung !== null && (
                  <ConfirmReadoutRow
                    label="Angelegt von"
                    value={einladung.erstellt_von}
                  />
                )}
                {einladung !== null && (
                  <ConfirmReadoutRow
                    label="Versand"
                    value={versandText}
                  />
                )}
              </dl>
            </div>

            {frisch !== null && (
              <div className="flex w-full flex-col gap-y-2">
                <h3 className={FORM_SECTION_HEADING_CLASSES}>Der Link</h3>
                {/* Read-only rather than a paragraph: the value is long and is meant to be selected,
                    and a textarea is the one field that wraps it without a scroll bar. */}
                <textarea
                  readOnly
                  aria-label="Registrierungslink"
                  rows={2}
                  value={frisch.link}
                  className={`${FIELD_TEXTAREA_CLASSES} w-full break-all`}
                />
                {/* Beside the box rather than under the failed press: a reader whose browser refuses
                    the clipboard is standing at the value, and the toast is gone in seconds. */}
                <p className="muted-hint">
                  {LINK_NUR_JETZT} {VON_HAND_KOPIEREN}
                </p>

                <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button
                    type="button"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => kopieren(frisch)}
                    className={`${formButton({ intent: "cancel", stacks: true })} gap-x-2`}>
                    <Copy
                      className="size-4.5"
                      aria-hidden="true"
                    />
                    Link kopieren
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    isPending={isMailing}
                    isDisabled={!isMailing && busy}
                    onPress={() => versenden(frisch)}
                    className={`${formButton({ stacks: true })} gap-x-2`}>
                    <Envelope
                      className="size-4.5"
                      aria-hidden="true"
                    />
                    {isMailing ? "Sendet..." : "Link per E-Mail senden"}
                  </Button>
                </div>
              </div>
            )}

            {einladung === null ? (
              <Button
                type="button"
                variant="primary"
                isPending={isMinting}
                isDisabled={!isMinting && (isFinishedSaison || busy)}
                onPress={() => startMinting(mint)}
                className={`${formButton({ stacks: true })} gap-x-2`}>
                <Link
                  className="size-4.5"
                  aria-hidden="true"
                />
                {isMinting ? "Legt an..." : "Registrierungslink anlegen"}
              </Button>
            ) : (
              <>
                {/* One armed state for both writes, picked before arming: each of the two ends the
                    standing link, so a preselection would arm the operation nobody read. */}
                <ToggleButtonGroup
                  aria-label="Was mit dem offenen Link passieren soll"
                  size="sm"
                  isDetached
                  isDisabled={isWriting}
                  selectionMode="single"
                  selectedKeys={gewaehlt === null ? [] : [gewaehlt]}
                  onSelectionChange={(keys: Set<Key>) => {
                    const [next] = [...keys].map(String);
                    // Disarms on every move: the reveal names one operation's loss, so a switch under
                    // an armed panel would have the second press confirm what the first never described.
                    cancel();
                    setGewaehlt(next === "ersetzen" || next === "zurueckziehen" ? next : null);
                  }}
                  className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN_CLASSES}`}>
                  <ToggleButton
                    id="ersetzen"
                    className={STUFE_CHIP_CLASSES}>
                    Ersetzen
                  </ToggleButton>
                  <ToggleButton
                    id="zurueckziehen"
                    className={STUFE_CHIP_CLASSES}>
                    Zurückziehen
                  </ToggleButton>
                </ToggleButtonGroup>

                <p className="muted-hint">
                  Beides beendet den offenen Link: Wer ihn hat, kommt damit nicht mehr in die Registrierung von Saison{" "}
                  <strong>{saisonId}</strong>.
                </p>

                {isConfirming && (
                  <ConfirmReveal>
                    <p className="fluid-xxs leading-normal font-medium text-foreground">
                      {gewaehlt === "zurueckziehen"
                        ? "Danach steht für dieses Team kein Link mehr offen. Wer den bisherigen weitergegeben hat, muss die Empfängerinnen und Empfänger selbst benachrichtigen."
                        : "Der bisherige Link öffnet danach nichts mehr. Der neue muss an alle, die den alten haben, erneut weitergegeben werden."}
                    </p>
                  </ConfirmReveal>
                )}

                <ConfirmActionRow confirm={twoPress}>
                  <ConfirmPressButton
                    confirm={twoPress}
                    reason={
                      gewaehlt === null
                        ? "Wähle, was mit dem offenen Link passieren soll."
                        : gewaehlt === "ersetzen" && isFinishedSaison
                          ? "Für eine abgeschlossene Saison wird kein Link mehr ausgegeben."
                          : null
                    }
                    resting={restingLabel}
                    armed={armedLabel}
                    running={gewaehlt === "zurueckziehen" ? "Zieht zurück..." : "Legt an..."}
                    icon={
                      gewaehlt === "zurueckziehen" ? (
                        <Ban
                          className="size-4.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <Link
                          className="size-4.5"
                          aria-hidden="true"
                        />
                      )
                    }
                    onPress={handlePress}
                  />
                </ConfirmActionRow>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
