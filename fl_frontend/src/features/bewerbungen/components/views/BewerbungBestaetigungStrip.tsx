"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CircleCheck, CircleXmark, Clock, PaperPlane, Pencil } from "@gravity-ui/icons";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";

import { einwilligungErneutSendenAction, kontaktEmailKorrigierenAction } from "@/features/bewerbungen/actions";
import { adressenAndererPersonen, istOffen, linkAngebot, loeschungsSatz } from "@/features/bewerbungen/bestaetigungStand";
import { ERNEUT_OHNE_ADRESSE } from "@/features/bewerbungen/constants";
import { FLBewerbungKontaktEmailPayloadSchema, gleicheAdresse } from "@/features/bewerbungen/schemas";
import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { labelBadge } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand";
import type { KontaktRolle } from "@/features/teams/constants";
import type { PillTone } from "@/shared/components/ui/badges";

/**
 * One height for every chip on this readout and for the control beside them, so a row carrying a
 * button does not stand taller than the rows that do not. `formButton`'s `xs` step is the other half.
 */
const STRIP_CHIP = "h-7 shrink-0";

/** Named rather than muted: a grey chip on a coloured row reads as disabled (my rule, 2026-09-04). */
const ROLLEN_TINT: PillTone = "info";

/**
 * Never `warning`, which is what the rows beneath give an outstanding SEAT: one tone for the summary
 * and the thing it summarises reads as one state (my rule, 2026-09-04).
 */
const ZAEHLER_TINT: Record<"offen" | "vollstaendig", PillTone> = { offen: "brand", vollstaendig: "success" };

const STAND_TINT: Record<SitzBestaetigung["stand"]["art"], PillTone> = {
  bestaetigt: "success",
  ausstehend: "warning",
  abgelehnt: "danger",
  // A decline's grade for a seat that ends the same way: neither can be confirmed, and both leave
  // the Absage as the one decision the application still takes.
  geloescht: "danger",
  // The erased seat's chip, because it carries the erased seat's sentence: one sentence in two tones
  // would read as two states.
  unbeantwortet: "danger",
};

const STAND_ICON = {
  bestaetigt: CircleCheck,
  ausstehend: Clock,
  abgelehnt: CircleXmark,
  geloescht: CircleXmark,
  unbeantwortet: CircleXmark,
} as const;

/** The queue's own wording for the same fact, so the two admin surfaces read alike. */
const KEINE_EMAIL = "Keine E-Mail";

const ADRESSE_BELEGT = "Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen.";

/**
 * A rejection carries no status and no body, so the write may have committed. A second re-send is safe
 * either way, which is why this one invites it.
 */
const ERNEUT_OHNE_ANTWORT = "Prüfe die Verbindung und sende den Link noch einmal. Ein neuer Link ersetzt einen, der schon rausging.";

/** Unlike a re-send, a second correction to an address already stored is refused, so the row decides. */
const KORREKTUR_OHNE_ANTWORT =
  "Prüfe die Verbindung und lade die Seite neu. Steht in der Zeile noch die alte Adresse, korrigiere sie noch einmal.";

/**
 * A readout above the fact panels rather than a section inside them, so the question deciding
 * whether the Zusage is possible at all is answered before the panels it governs.
 */
export function BewerbungBestaetigungStrip({
  bewerbungId,
  staende,
  frist,
  isOpen,
}: {
  bewerbungId: string;
  staende: readonly SitzBestaetigung[];
  /** The day an incomplete application is deleted after, or `null` where none is recorded. */
  frist: string | null;
  /** Whether the application is still `eingereicht` — the one state a re-sent link can be answered in. */
  isOpen: boolean;
}) {
  const router = useRouter();
  // Per seat rather than one flag: three buttons stand here, and one press must not hold the others.
  const [sendendeRollen, setSendendeRollen] = useState<ReadonlySet<KontaktRolle>>(() => new Set());

  /**
   * One editor for the whole strip (`docs/frontend/spec.md :: I66` gives a panel one action row), so
   * opening a second row drops the first's draft — one address nobody has written yet.
   */
  const [korrektur, setKorrektur] = useState<KontaktRolle | null>(null);

  const panel = formPanel();
  const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;
  const angebot = linkAngebot(staende);
  const loeschung = loeschungsSatz({ staende, frist, eingereicht: isOpen, heute: getGermanTodayStr() });

  const sendeErneut = async (rolle: KontaktRolle) => {
    setSendendeRollen((vorher) => new Set(vorher).add(rolle));

    // Awaited outside a transition, so a rejected action reaches no error boundary: uncaught, it leaves
    // „Sendet...“ standing for good and reports nothing.
    const res = await einwilligungErneutSendenAction({ id: bewerbungId, rolle: rolle }).catch(() => null);

    // This seat alone, through the updater, so two writes settling never clear each other.
    setSendendeRollen((vorher) => new Set([...vorher].filter((sendend) => sendend !== rolle)));

    // Before the toast either way: the failure arm reports a write that committed, so the readout
    // beneath it is stale on exactly the press that says so. A rejected write may have committed too.
    router.refresh();

    if (res === null) {
      appToast.danger("Unklar, ob es bei uns angekommen ist", { description: ERNEUT_OHNE_ANTWORT });
      return;
    }

    if (!res.success) {
      appToast.danger("Link nicht erneut gesendet", { description: res.error });
      return;
    }

    appToast.success("Link erneut gesendet", { description: res.message });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        {/* The count beside the heading, in the shape `AdminBewerbungView`'s own header gives a
            status chip: `PanelHeading` has one slot and it belongs to the hint glyph. */}
        <div className="flex w-full flex-row items-center gap-x-3">
          <PanelHeading
            className={panel.heading()}
            title="Bestätigungen"
          />
          <span className="shrink-0">
            <span className={`${labelBadge(bestaetigt === staende.length ? ZAEHLER_TINT.vollstaendig : ZAEHLER_TINT.offen)} ${STRIP_CHIP}`}>
              {String(bestaetigt)} von {String(staende.length)} bestätigt
            </span>
          </span>
        </div>
      </div>

      <div className={panel.body()}>
        <div className="flex w-full flex-col gap-y-3">
          {staende.map((sitz) => (
            <SitzZeile
              key={sitz.rolle}
              bewerbungId={bewerbungId}
              sitz={sitz}
              belegteAdressen={adressenAndererPersonen(staende, sitz)}
              hatAngebot={isOpen && angebot.has(sitz.rolle)}
              sendet={sendendeRollen.has(sitz.rolle)}
              bearbeitet={korrektur === sitz.rolle}
              onSendeErneut={() => void sendeErneut(sitz.rolle)}
              onKorrigieren={() => {
                setKorrektur(sitz.rolle);
              }}
              onSchliessen={() => {
                setKorrektur(null);
              }}
            />
          ))}
        </div>

        {/* The deletion date stands here and nowhere else on the page: the reason under the closed
            Zusage says what is missing, and this says what happens if it stays missing. */}
        {loeschung !== null && <p className="muted-hint">{loeschung}</p>}
      </div>
    </section>
  );
}

/**
 * One seat: who stands in it and where the league writes to them, then what their link has reached
 * and the two things an administrator can do about it.
 */
function SitzZeile({
  bewerbungId,
  sitz,
  belegteAdressen,
  hatAngebot,
  sendet,
  bearbeitet,
  onSendeErneut,
  onKorrigieren,
  onSchliessen,
}: {
  bewerbungId: string;
  sitz: SitzBestaetigung;
  belegteAdressen: readonly string[];
  /** Whether a link can still be sent to this seat, which is the one condition both controls stand under. */
  hatAngebot: boolean;
  sendet: boolean;
  bearbeitet: boolean;
  onSendeErneut: () => void;
  onKorrigieren: () => void;
  onSchliessen: () => void;
}) {
  const Glyph = STAND_ICON[sitz.stand.art];
  const zustellung = sitz.zustellung === null ? null : ZUSTELLUNG_CHIP[sitz.zustellung.stand];
  const erneutLabel = `Link erneut senden an ${sitz.label}`;

  const stiftRef = useRef<HTMLButtonElement>(null);
  const warBearbeitet = useRef(false);

  // A keyboard user whose focused input has just unmounted would otherwise be dropped on the
  // document body. An effect rather than the handler: the pencil exists only after the re-render.
  useEffect(() => {
    if (warBearbeitet.current && !bearbeitet) stiftRef.current?.focus();
    warBearbeitet.current = bearbeitet;
  }, [bearbeitet]);

  return (
    <div className="flex w-full flex-col gap-y-2">
      <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`${labelBadge(ROLLEN_TINT)} ${STRIP_CHIP}`}>{sitz.label}</span>
        {sitz.zugleichTrainer && <span className={`${labelBadge("info")} ${STRIP_CHIP}`}>Zugleich Trainer</span>}

        <span className="fluid-sm text-foreground min-w-0 font-medium">
          {sitz.name === null ? <span className="text-foreground-muted italic">{sitz.nameSatz}</span> : sitz.nameSatz}
        </span>

        {/* The foreground grade rather than the queue's muted one: it is the value the pencil beside
            it edits and the thing the delivery chip is about. */}
        {sitz.name !== null && (
          <span className="fluid-xs text-foreground max-w-full min-w-0 truncate font-medium">
            {sitz.email ?? <span className="text-foreground-muted italic">{KEINE_EMAIL}</span>}
          </span>
        )}

        {/* Beside the address rather than in the right-hand cluster, which is about the link: every
            control on this site stands where the value it edits is. */}
        {hatAngebot && !bearbeitet && (
          <IconTooltip label="Adresse korrigieren">
            <Button
              ref={stiftRef}
              type="button"
              isPending={sendet}
              aria-label={`E-Mail-Adresse von ${sitz.nameSatz} korrigieren`}
              onPress={onKorrigieren}
              className={`${formButton({ intent: "nav", size: "xs" })} shrink-0`}>
              <Pencil
                className="size-3.5"
                aria-hidden="true"
              />
            </Button>
          </IconTooltip>
        )}

        <span className={`${labelBadge(STAND_TINT[sitz.stand.art])} ${STRIP_CHIP} ml-auto gap-x-1`}>
          <Glyph
            className="size-3.5"
            aria-hidden="true"
          />
          {sitz.satz}
        </span>

        {/* Between the seat's own state and the re-send, so a refused delivery reads next to the link
            it refused rather than next to the person. */}
        {zustellung !== null && <span className={`${labelBadge(zustellung.tone)} ${STRIP_CHIP}`}>{zustellung.label}</span>}

        {hatAngebot && !bearbeitet && (
          // Closed rather than withheld where the seat has no address, so the refusal can name the
          // pencil beside it as the way out. `sendet` is left out of the reason: it ends by itself.
          <Hint
            mode="refusal"
            reason={sitz.email === null ? ERNEUT_OHNE_ADRESSE : null}
            label={erneutLabel}
            className="shrink-0">
            <Button
              type="button"
              isPending={sendet}
              isDisabled={sitz.email === null}
              aria-label={erneutLabel}
              onPress={onSendeErneut}
              className={`${formButton({ intent: "nav", size: "xs" })} shrink-0 gap-x-2`}>
              <PaperPlane
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{sendet ? "Sendet..." : "Link erneut senden"}</span>
            </Button>
          </Hint>
        )}
      </div>

      {bearbeitet && (
        <AdresseKorrigieren
          bewerbungId={bewerbungId}
          rolle={sitz.rolle}
          gespeicherteAdresse={sitz.email}
          belegteAdressen={belegteAdressen}
          onFertig={onSchliessen}
        />
      )}
    </div>
  );
}

/**
 * A bordered box rather than a bare block: three rows sit at `gap-y-3`, and a field floating under
 * the second reads as either neighbour's. **No `role="alert"`** — it keeps `ConfirmReveal`'s
 * geometry and escalates nothing.
 */
function AdresseKorrigieren({
  bewerbungId,
  rolle,
  gespeicherteAdresse,
  belegteAdressen,
  onFertig,
}: {
  bewerbungId: string;
  rolle: KontaktRolle;
  gespeicherteAdresse: string | null;
  belegteAdressen: readonly string[];
  onFertig: () => void;
}) {
  const router = useRouter();

  // Prefilled, because the commonest correction is one wrong character.
  const [email, setEmail] = useState(gespeicherteAdresse ?? "");
  const [sendet, setSendet] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { korrektur: FLBewerbungKontaktEmailPayloadSchema },
  });

  const payload = { id: bewerbungId, rolle: rolle, email: email };

  useForgiveFixed({ korrektur: payload });

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the pencil
  // unmounts with the press that opened this box, leaving a keyboard user on the document body.
  useEffect(() => {
    formRef.current?.querySelector("input")?.focus();
  }, [formRef]);

  // A press that corrects nothing is a re-send wearing another name, and the re-send has its own
  // control. The refusal on it says what opens it.
  const unveraendert = email.trim() === "" || gleicheAdresse(email, gespeicherteAdresse ?? "");

  const schreibe = async () => {
    // The submission's own rule, judged here so the administrator is told at the field rather than
    // by a round trip. The backend refuses it regardless.
    if (belegteAdressen.some((belegt) => gleicheAdresse(email, belegt))) {
      setSubmitFieldErrors({ email: ADRESSE_BELEGT }, { korrektur: payload });
      return;
    }

    setSendet(true);
    // Caught for the re-send's reason: awaited outside a transition, a rejection would leave „Sendet...“ standing.
    const res = await kontaktEmailKorrigierenAction(payload).catch(() => null);
    setSendet(false);

    if (res === null) {
      // Left open: the draft is what a second press sends, and the refreshed row says whether one is owed.
      router.refresh();
      appToast.danger("Unklar, ob es bei uns angekommen ist", { description: KORREKTUR_OHNE_ANTWORT });
      return;
    }

    if (!res.success) {
      if (res.fieldErrors !== undefined) {
        setSubmitFieldErrors(res.fieldErrors, { korrektur: payload });
        return;
      }

      // Every mapped refusal ends in „Lade die Seite neu", so the refresh has already run by the
      // time the administrator reads it.
      router.refresh();
      onFertig();
      appToast.danger("Adresse nicht korrigiert", { description: res.error });
      return;
    }

    // Before the toast, as the re-send does it: the row beneath is stale on exactly the press that
    // says the address moved.
    router.refresh();
    onFertig();

    if (res.verschickt === false) {
      appToast.warning("Link nicht gesendet", {
        description:
          "Die Adresse ist korrigiert, aber die E-Mail mit dem neuen Link ging nicht raus, und der alte Link gilt nicht mehr. Schicke den Link erneut.",
      });
      return;
    }

    appToast.success("Adresse korrigiert", { description: res.message });
  };

  return (
    <Form
      ref={formRef}
      validationBehavior="aria"
      validationErrors={fieldErrors}
      onSubmit={runOnSubmit(() => {
        // The pending button is not the whole guard: `Enter` in the field submits too, and a second
        // correction mid-flight is refused as already stored.
        if (sendet) return;

        guardSubmit({ korrektur: payload }, () => void schreibe());
      })}
      className={`${PANEL_REVEAL} border-border bg-surface flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
      <TextField
        isRequired
        type="email"
        name="email"
        value={email}
        onChange={setEmail}
        onBlur={() => {
          validatePaths("korrektur", payload, ["email"]);
        }}
        className="w-full sm:max-w-md">
        {/* Not the form's „E-Mail“: the row above still shows the stored address, so the reader sees
            old over new, which is what a correction is. */}
        <Label className={FIELD_LABEL}>Neue E-Mail-Adresse</Label>
        <Input
          placeholder="z.B. name@beispiel.de"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        {/* On the control, never a sentence beside it that the first keystroke would unmount under the
            administrator typing (`docs/frontend/spec.md` §1.14). `sendet` is left out: it ends by itself. */}
        <Hint
          mode="refusal"
          reason={!sendet && unveraendert ? "Gib zuerst eine andere E-Mail-Adresse ein." : null}
          label="Korrigieren und Link senden">
          <Button
            type="submit"
            variant="primary"
            isPending={sendet}
            isDisabled={!sendet && unveraendert}
            className={formButton({ intent: "submit", stacks: true })}>
            {sendet ? "Sendet..." : "Korrigieren und Link senden"}
          </Button>
        </Hint>
        {/* Held while the write runs: a press that unmounts this box mid-transition drops the toast
            that would have named the outcome. */}
        <Button
          type="button"
          variant="secondary"
          isPending={sendet}
          onPress={onFertig}
          className={formButton({ intent: "cancel", stacks: true })}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
