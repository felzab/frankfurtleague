"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import CircleXmark from "@gravity-ui/icons/CircleXmark";
import Clock from "@gravity-ui/icons/Clock";
import PaperPlane from "@gravity-ui/icons/PaperPlane";
import Pencil from "@gravity-ui/icons/Pencil";
import PersonPlus from "@gravity-ui/icons/PersonPlus";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";

import { KONTAKT_EMAIL } from "@/core/brand";
import { LIGA_KENNTNISNAHME } from "@/core/einwilligung";
import { besetzeKontaktSitzAction, einwilligungErneutSendenAction, kontaktEmailKorrigierenAction } from "@/features/bewerbungen/actions";
import { adressenAndererPersonen, istOffen, linkAngebot, loeschungsSatz, sitzAngebot } from "@/features/bewerbungen/bestaetigungStand";
import { ERNEUT_OHNE_ADRESSE } from "@/features/bewerbungen/constants";
import {
  FLBewerbungKontaktEmailPayloadSchema,
  FLBewerbungKontaktSitzPayloadSchema,
  gleicheAdresse,
  gleichesPostfach,
} from "@/features/bewerbungen/schemas";
import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { labelBadge } from "@/shared/components/ui/badges";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { PANEL_REVEAL_CLASSES } from "@/shared/components/ui/motion";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";

import { Absatz } from "./BestaetigungHinweise";

import type { BESTAETIGUNG_ABSAETZE } from "@/core/einwilligung";
import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand";
import type { KontaktRolle } from "@/features/teams/constants";
import type { PillTone } from "@/shared/components/ui/badges";
import type { RaiseFailure } from "@/shared/hooks/useServerFieldErrors";

/**
 * One height for every chip on this readout and for the control beside them, so a row carrying a
 * button does not stand taller than the rows that do not. `formButton`'s `xs` step is the other half.
 */
const STRIP_CHIP_CLASSES = "h-7 shrink-0";

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
 * A rejected action carries no status and no body, so it says nothing of whether the write
 * committed. A second re-send is safe either way, which is why this one invites it.
 */
const ERNEUT_OHNE_ANTWORT = "Prüfe die Verbindung und sende den Link noch einmal. Ein neuer Link ersetzt einen, der schon rausging.";

/** Unlike a re-send, a second correction to an address already stored is refused, so the row decides. */
const KORREKTUR_OHNE_ANTWORT =
  "Prüfe die Verbindung und lade die Seite neu. Steht in der Zeile noch die alte Adresse, korrigiere sie noch einmal.";

/** A second reseat over a seat already filled is refused, so the refreshed row is what says whether one is owed. */
const BESETZUNG_OHNE_ANTWORT = "Prüfe die Verbindung und lade die Seite neu. Steht in der Zeile noch niemand, besetze die Rolle noch einmal.";

/** Which of the two editors one row has open. One at a time for the whole strip (`docs/frontend/spec.md :: I66`). */
type Bearbeitung = "korrektur" | "neubesetzung";

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
  const [editor, setEditor] = useState<{ rolle: KontaktRolle; art: Bearbeitung } | null>(null);

  const panel = formPanel();
  const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;
  const angebot = linkAngebot(staende);
  const neubesetzbar = sitzAngebot(staende);
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

    // Thrown, no answer came back, so this control's repair names the connection; an answer, an
    // unknown outcome among them, carries its own sentence.
    if (res === null || !res.success) {
      appToast.failure("Link nicht erneut gesendet", res ?? { error: ERNEUT_OHNE_ANTWORT, outcome: "unknown" });
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
            <span
              className={`${labelBadge(bestaetigt === staende.length ? ZAEHLER_TINT.vollstaendig : ZAEHLER_TINT.offen)} ${STRIP_CHIP_CLASSES}`}>
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
              istNeubesetzbar={isOpen && neubesetzbar.has(sitz.rolle)}
              sendet={sendendeRollen.has(sitz.rolle)}
              bearbeitet={editor?.rolle === sitz.rolle ? editor.art : null}
              onSendeErneut={() => void sendeErneut(sitz.rolle)}
              onOeffne={(art) => {
                setEditor({ rolle: sitz.rolle, art: art });
              }}
              onSchliessen={() => {
                setEditor(null);
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
  istNeubesetzbar,
  sendet,
  bearbeitet,
  onSendeErneut,
  onOeffne,
  onSchliessen,
}: {
  bewerbungId: string;
  sitz: SitzBestaetigung;
  belegteAdressen: readonly string[];
  /** Whether a link can still be sent to this seat, which is the one condition the pencil and the re-send stand under. */
  hatAngebot: boolean;
  /** Whether this seat's own person stepped out of it, which is the one state another person is written into. */
  istNeubesetzbar: boolean;
  sendet: boolean;
  bearbeitet: Bearbeitung | null;
  onSendeErneut: () => void;
  onOeffne: (art: Bearbeitung) => void;
  onSchliessen: () => void;
}) {
  const Glyph = STAND_ICON[sitz.stand.art];
  const zustellung = sitz.zustellung === null ? null : ZUSTELLUNG_CHIP[sitz.zustellung.stand];
  const erneutLabel = `Link erneut senden an ${sitz.label}`;
  const besetzenLabel = `${sitz.label} neu besetzen`;

  const stiftRef = useRef<HTMLButtonElement>(null);
  const besetzenRef = useRef<HTMLButtonElement>(null);
  const warBearbeitet = useRef<Bearbeitung | null>(null);

  // A keyboard user whose focused input has just unmounted would otherwise be dropped on the
  // document body. An effect rather than the handler: the control exists only after the re-render.
  useEffect(() => {
    const geschlossen = warBearbeitet.current;
    if (geschlossen !== null && bearbeitet === null) {
      (geschlossen === "korrektur" ? stiftRef : besetzenRef).current?.focus();
    }
    warBearbeitet.current = bearbeitet;
  }, [bearbeitet]);

  return (
    <div className="flex w-full flex-col gap-y-2">
      <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`${labelBadge(ROLLEN_TINT)} ${STRIP_CHIP_CLASSES}`}>{sitz.label}</span>
        {sitz.zugleichTrainer && <span className={`${labelBadge("info")} ${STRIP_CHIP_CLASSES}`}>Zugleich Trainer</span>}

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
        {hatAngebot && bearbeitet === null && (
          <IconTooltip label="Adresse korrigieren">
            <Button
              ref={stiftRef}
              type="button"
              isPending={sendet}
              aria-label={`E-Mail-Adresse von ${sitz.nameSatz} korrigieren`}
              onPress={() => {
                onOeffne("korrektur");
              }}
              className={`${formButton({ intent: "nav", size: "xs" })} shrink-0`}>
              <Pencil
                className="size-3.5"
                aria-hidden="true"
              />
            </Button>
          </IconTooltip>
        )}

        <span className={`${labelBadge(STAND_TINT[sitz.stand.art])} ${STRIP_CHIP_CLASSES} ml-auto gap-x-1`}>
          <Glyph
            className="size-3.5"
            aria-hidden="true"
          />
          {sitz.satz}
        </span>

        {/* Between the seat's own state and the re-send, so a refused delivery reads next to the link
            it refused rather than next to the person. */}
        {zustellung !== null && <span className={`${labelBadge(zustellung.tone)} ${STRIP_CHIP_CLASSES}`}>{zustellung.label}</span>}

        {/* In the right-hand cluster where the re-send stands, never beside the name: what it offers
            is a fresh link for this seat, and the two are never offered at once. */}
        {istNeubesetzbar && bearbeitet === null && (
          <Button
            ref={besetzenRef}
            type="button"
            aria-label={besetzenLabel}
            onPress={() => {
              onOeffne("neubesetzung");
            }}
            className={`${formButton({ intent: "nav", size: "xs" })} shrink-0 gap-x-2`}>
            <PersonPlus
              className="size-3.5"
              aria-hidden="true"
            />
            <span>Neu besetzen</span>
          </Button>
        )}

        {hatAngebot && bearbeitet === null && (
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

      {bearbeitet === "korrektur" && (
        <AdresseKorrigieren
          bewerbungId={bewerbungId}
          rolle={sitz.rolle}
          gespeicherteAdresse={sitz.email}
          belegteAdressen={belegteAdressen}
          onFertig={onSchliessen}
        />
      )}

      {bearbeitet === "neubesetzung" && (
        <SitzNeuBesetzen
          bewerbungId={bewerbungId}
          rolle={sitz.rolle}
          label={sitz.label}
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

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
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
  const unveraendert = email.trim() === "" || gleichesPostfach(email, gespeicherteAdresse ?? "");

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

    // One raise for every arm below, so the title has one site.
    const nichtKorrigiert: RaiseFailure = (shown) => appToast.failure("Adresse nicht korrigiert", shown);

    // Thrown or answered, a press nobody can tell landed. Left open: the draft is what a second press
    // sends, and the refreshed row says whether one is owed.
    if (res === null || (!res.success && res.outcome === "unknown")) {
      router.refresh();
      // Thrown, no answer came back, so this control's repair names the connection.
      nichtKorrigiert(res ?? { success: false, error: KORREKTUR_OHNE_ANTWORT, outcome: "unknown" });
      return;
    }

    if (!res.success) {
      // A refusal carrying a map leaves the box open, and the hook says whether the box took it.
      if (!hasFieldErrors(res.fieldErrors)) {
        // Every mapped refusal ends in „Lade die Seite neu“, so the refresh has already run by the
        // time the administrator reads it.
        router.refresh();
        onFertig();
      }
      reportSubmitFailure(res, { korrektur: payload }, { raise: nichtKorrigiert });
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
      validationErrors={fieldErrors}
      onSubmit={runOnSubmit(() => {
        // The pending button is not the whole guard: `Enter` in the field submits too, and a second
        // correction mid-flight is refused as already stored.
        if (sendet) return;

        guardSubmit({ korrektur: payload }, () => void schreibe());
      })}
      className={`${PANEL_REVEAL_CLASSES} border-border bg-surface flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
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
        <Label className={FIELD_LABEL_CLASSES}>Neue E-Mail-Adresse</Label>
        <Input
          placeholder="z.B. name@beispiel.de"
          className={FIELD_INPUT_CLASSES}
        />
        <FieldError className={FIELD_ERROR_CLASSES} />
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

/** A blank person, because nobody stands in this seat: `AdresseKorrigieren`'s box prefills where it is repairing one character. */
const LEERE_PERSON = { vorname: "", nachname: "", email: "", telefon: "" };

// The confirmation page's opening section in its order, less each paragraph with a slot this strip
// cannot fill as the page does: a slot left standing is a word the person never sees.
const SEITENANFANG = [
  "gespeichert",
  "rechtsgrundlage",
  "nichtOeffentlich",
  "fristAbgelehnt",
  "fristUnvollstaendig",
  "widerruf",
  "art21",
] as const satisfies readonly (keyof typeof BESTAETIGUNG_ABSAETZE)[];

/** The box `AdresseKorrigieren` opens in, carrying four fields rather than one: this writes a whole person. */
function SitzNeuBesetzen({
  bewerbungId,
  rolle,
  label,
  belegteAdressen,
  onFertig,
}: {
  bewerbungId: string;
  rolle: KontaktRolle;
  /** The seat's own German, so the heading names the role the strip's chip beside it named. */
  label: string;
  belegteAdressen: readonly string[];
  onFertig: () => void;
}) {
  const router = useRouter();

  const [person, setPerson] = useState(LEERE_PERSON);
  const [sendet, setSendet] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { neubesetzung: FLBewerbungKontaktSitzPayloadSchema },
  });

  // The label the new person will be shown, written from the registry rather than typed, as the
  // application form writes it: a later rewording never changes what a stored record claims.
  const payload = { id: bewerbungId, rolle: rolle, ...person, text_version: LIGA_KENNTNISNAHME.textVersion };

  useForgiveFixed({ neubesetzung: payload });

  // For `AdresseKorrigieren`'s reason: the control that opened this box unmounts with the press.
  useEffect(() => {
    formRef.current?.querySelector("input")?.focus();
  }, [formRef]);

  const unvollstaendig = Object.values(person).some((wert) => wert.trim() === "");

  const schreibe = async () => {
    // The submission's own rule, judged here so the administrator is told at the field rather than
    // by a round trip. The backend refuses it regardless.
    if (belegteAdressen.some((belegt) => gleicheAdresse(person.email, belegt))) {
      setSubmitFieldErrors({ email: ADRESSE_BELEGT }, { neubesetzung: payload });
      return;
    }

    setSendet(true);
    // Caught for the re-send's reason: awaited outside a transition, a rejection would leave „Sendet...“ standing.
    const res = await besetzeKontaktSitzAction(payload).catch(() => null);
    setSendet(false);

    // One raise for every arm below, so the title has one site.
    const nichtBesetzt: RaiseFailure = (shown) => appToast.failure("Rolle nicht neu besetzt", shown);

    // Thrown or answered, a press nobody can tell landed. Left open: the draft is what a second press
    // sends, and the refreshed row says whether one is owed.
    if (res === null || (!res.success && res.outcome === "unknown")) {
      router.refresh();
      // Thrown, no answer came back, so this control's repair names the connection.
      nichtBesetzt(res ?? { success: false, error: BESETZUNG_OHNE_ANTWORT, outcome: "unknown" });
      return;
    }

    if (!res.success) {
      // A refusal carrying a map leaves the box open, and the hook says whether the box took it.
      if (!hasFieldErrors(res.fieldErrors)) {
        // Every mapped refusal ends in „Lade die Seite neu“, so the refresh has already run by the
        // time the administrator reads it.
        router.refresh();
        onFertig();
      }
      reportSubmitFailure(res, { neubesetzung: payload }, { raise: nichtBesetzt });
      return;
    }

    // Before the toast, as the correction does it: the row beneath is stale on exactly the press
    // that says somebody now stands in the seat.
    router.refresh();
    onFertig();

    if (res.verschickt === false) {
      // Its own title, never the correction's „Link nicht gesendet“: one title names one outcome,
      // and this one says the seat is filled where that one says an address moved.
      appToast.warning("Rolle besetzt, Link nicht gesendet", {
        description:
          "Die Person steht jetzt in der Bewerbung, aber die E-Mail mit ihrem Bestätigungslink ging nicht raus. Schicke den Link erneut.",
      });
      return;
    }

    appToast.success("Rolle neu besetzt", { description: res.message });
  };

  return (
    <Form
      ref={formRef}
      validationErrors={fieldErrors}
      onSubmit={runOnSubmit(() => {
        // The pending button is not the whole guard: `Enter` in a field submits too, and a second
        // press mid-flight is refused as a seat already filled.
        if (sendet) return;

        guardSubmit({ neubesetzung: payload }, () => void schreibe());
      })}
      className={`${PANEL_REVEAL_CLASSES} border-border bg-surface flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
      {/* The seat is named here and not on the button: the row above says „Niemand mehr in der
          Bewerbung“, so the box has to say which of the three seats it is filling. */}
      <p className="fluid-xs text-foreground-muted">Neue Person für die Rolle {label}</p>

      {/* The confirmation page's words, never the application form's: those address the submitter,
          and the person this writes will only ever read the page. */}
      <div className="border-border flex flex-col gap-y-2 rounded-lg border p-3">
        <p className="fluid-xs text-foreground font-bold">Diese Person bekommt den Bestätigungslink und wird dort gefragt:</p>
        {SEITENANFANG.map((schluessel) => (
          <p
            key={schluessel}
            className="muted-meta">
            <Absatz
              schluessel={schluessel}
              werte={{ kontakt: KONTAKT_EMAIL }}
            />
          </p>
        ))}
      </div>

      <div className={FIELD_PAIR_CLASSES}>
        <TextField
          isRequired
          name="vorname"
          value={person.vorname}
          onChange={(next) => setPerson({ ...person, vorname: next })}
          onBlur={() => {
            validatePaths("neubesetzung", payload, ["vorname"]);
          }}>
          <Label className={FIELD_LABEL_CLASSES}>Vorname</Label>
          <Input className={FIELD_INPUT_CLASSES} />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>

        <TextField
          isRequired
          name="nachname"
          value={person.nachname}
          onChange={(next) => setPerson({ ...person, nachname: next })}
          onBlur={() => {
            validatePaths("neubesetzung", payload, ["nachname"]);
          }}>
          <Label className={FIELD_LABEL_CLASSES}>Nachname</Label>
          <Input className={FIELD_INPUT_CLASSES} />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>
      </div>

      <div className={FIELD_PAIR_CLASSES}>
        <TextField
          isRequired
          type="email"
          name="email"
          value={person.email}
          onChange={(next) => setPerson({ ...person, email: next })}
          onBlur={() => {
            validatePaths("neubesetzung", payload, ["email"]);
          }}>
          <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
          <Input
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>

        <TextField
          isRequired
          type="tel"
          name="telefon"
          value={person.telefon}
          onChange={(next) => setPerson({ ...person, telefon: next })}
          onBlur={() => {
            validatePaths("neubesetzung", payload, ["telefon"]);
          }}>
          <Label className={FIELD_LABEL_CLASSES}>Telefon</Label>
          <Input
            placeholder="z.B. 069 1234567"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        {/* On the control, as the correction's is (`docs/frontend/spec.md` §1.14). `sendet` is left
            out of the reason: it ends by itself. */}
        <Hint
          mode="refusal"
          reason={!sendet && unvollstaendig ? "Fülle zuerst alle vier Felder aus." : null}
          label="Neu besetzen und Link senden">
          <Button
            type="submit"
            variant="primary"
            isPending={sendet}
            isDisabled={!sendet && unvollstaendig}
            className={formButton({ intent: "submit", stacks: true })}>
            {sendet ? "Sendet..." : "Neu besetzen und Link senden"}
          </Button>
        </Hint>
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
