import { FieldError, ListBox, Select } from "@heroui/react";

import { SONDEREREIGNIS_LABELS, SONDEREREIGNIS_NONE_LABEL, SONDEREREIGNIS_OPTIONS } from "@/features/spiele/constants";
import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSonderereignis } from "@/features/spiele/schemas";
import type { Key } from "@heroui/react";
import type { SpielBanner } from "./banners";

/**
 * The ordinary fixture's key in the collection. react-aria addresses an option by `Key`, which has no
 * null, so the absence of an event needs a spelling of its own here — and one that cannot collide
 * with a member of `FLSonderereignis`.
 */
const NONE_KEY = "regulaer";

/** What each member does to the fixture, in one line, for the panel's own explanation. */
const SONDEREREIGNIS_EFFECT: Record<FLSonderereignis, string> = {
  ausgefallen: "findet nicht statt, wird nicht gewertet und trägt kein Ergebnis.",
  nichtantreten_team1: "Team 1 ist nicht erschienen; gewertet wird für Team 2, nach den Regeln der Saison.",
  nichtantreten_team2: "Team 2 ist nicht erschienen; gewertet wird für Team 1, nach den Regeln der Saison.",
  abgebrochen: "hat stattgefunden und wird weiter wie ein gespieltes Spiel behandelt.",
  annulliert: "zählt nicht mehr, wird nicht gewertet und trägt kein Ergebnis.",
};

/**
 * **A fixture's event is not the absence of a result**: `abgebrochen` may carry any score and a
 * Nichtantreten is awarded one, so nothing here clears the result.
 */
export function FormSonderereignisSection({
  sonderereignis,
  hasBothSides,
  onSonderereignisChange,
  banners,
}: {
  sonderereignis: FLSonderereignis | null;
  /** Both slots hold a club in the DRAFT — `REQ-STATE-003`'s condition, which an open bracket slot fails. */
  hasBothSides: boolean;
  onSonderereignisChange: (value: FLSonderereignis | null) => void;
  banners: readonly SpielBanner[];
}) {
  const styles = formPanel({ tone: "danger" });
  const status = useFieldStatus("sonderereignis");

  // An unresolved slot has nobody who could have failed to appear, and the award would have no side
  // to land on — so the write path answers `REQ-STATE-003` and this must not offer it.
  const unpickableReason = (event: FLSonderereignis): string | undefined =>
    !hasBothSides && (event === "nichtantreten_team1" || event === "nichtantreten_team2") ? "beide Teams nötig" : undefined;

  // An unrecognised key cannot arrive from a closed collection, so it reads as the ordinary fixture
  // rather than throwing on a page holding unsaved work.
  const handleChange = (key: Key | null) => {
    const picked = SONDEREREIGNIS_OPTIONS.find((event) => event === key?.toString());
    onSonderereignisChange(picked ?? null);
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Sonderereignis
          <InfoHint label="Hinweis zum Sonderereignis">
            <p>Was mit dem Spiel geschehen ist, über das Spielen hinaus. Ein Spiel trägt höchstens eines.</p>
            <ul>
              {SONDEREREIGNIS_OPTIONS.map((event) => (
                <li key={event}>
                  <strong>{SONDEREREIGNIS_LABELS[event]}</strong> {SONDEREREIGNIS_EFFECT[event]}
                </li>
              ))}
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <Select
          name="sonderereignis"
          value={sonderereignis ?? NONE_KEY}
          onChange={handleChange}
          isInvalid={status?.error ? true : undefined}
          className="w-full">
          <FieldLabel path="sonderereignis">Sonderereignis</FieldLabel>

          <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
            {/* From the prop rather than `Select.Value`, which resolves its label out of the
                react-aria collection and shows HeroUI's English placeholder on a render where that
                collection has not committed — `SaisonSelector`'s reason. */}
            <span className={sonderereignis === null ? "text-foreground-muted" : "text-danger-strong font-bold"}>
              {sonderereignis === null ? SONDEREREIGNIS_NONE_LABEL : SONDEREREIGNIS_LABELS[sonderereignis]}
            </span>
            <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
          </Select.Trigger>

          <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
            <ListBox aria-label="Sonderereignis">
              {/* The ordinary fixture leads, being both the default and the way back out of every
                  other member. */}
              <ListBox.Item
                key={NONE_KEY}
                id={NONE_KEY}
                textValue={SONDEREREIGNIS_NONE_LABEL}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base)">
                {SONDEREREIGNIS_NONE_LABEL}
              </ListBox.Item>

              {SONDEREREIGNIS_OPTIONS.map((event) => {
                const reason = unpickableReason(event);

                return (
                  // Visible and disabled rather than gone, which is `FormGruppenSwapSection`'s rule:
                  // an admin should see why a state is out of reach, not wonder where it went.
                  <ListBox.Item
                    key={event}
                    id={event}
                    textValue={SONDEREREIGNIS_LABELS[event]}
                    isDisabled={reason !== undefined}
                    className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40">
                    <span className="min-w-0 truncate">{SONDEREREIGNIS_LABELS[event]}</span>
                    {reason !== undefined && <span className="fluid-xs text-foreground-muted shrink-0 font-semibold">{reason}</span>}
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Select.Popover>

          <FieldError className={FIELD_ERROR}>{status?.error}</FieldError>
        </Select>

        {/* Announced, the admin having just chosen it. The unexpected consequence is that four of the
            five members stop the fixture being reported under the "fehlt" categories, quietly ending
            the chase for a date, a venue and a referee. */}
        <InlineBanners
          banners={banners}
          spot="sonderereignis-bedeutung"
          isAnnounced
        />

        {/* Separate from the general one, a single long callout being one that gets skipped. Not
            announced: two alerts for one pick is a scolding. */}
        <InlineBanners
          banners={banners}
          spot="sonderereignis-turnierbaum"
        />

        {/* Where the event and the result meet — a refusal, an awarded forfeit or a genuinely
            ambiguous abandonment. Standing, not announced: each describes the combination rather
            than the pick. */}
        <InlineBanners
          banners={banners}
          spot="sonderereignis-wertung"
        />
      </div>
    </section>
  );
}
