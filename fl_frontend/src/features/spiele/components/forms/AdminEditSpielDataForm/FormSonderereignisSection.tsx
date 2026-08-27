import { FieldError, ListBox, Select, Switch } from "@heroui/react";

import { SONDEREREIGNIS_LABELS, SONDEREREIGNIS_OPTIONS } from "@/features/spiele/constants";
import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSonderereignis } from "@/features/spiele/schemas";
import type { Key } from "@heroui/react";
import type { SpielBanner } from "./banners";

/**
 * **A fixture's event is not the absence of a result**: `abgebrochen` may carry any score and a
 * Nichtantreten is awarded one, so nothing here clears the result.
 */
export function FormSonderereignisSection({
  sonderereignis,
  hasSonderereignis,
  onHasSonderereignisChange,
  hasBothSides,
  onSonderereignisChange,
  banners,
}: {
  sonderereignis: FLSonderereignis | null;
  hasSonderereignis: boolean;
  onHasSonderereignisChange: (next: boolean) => void;
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
    !hasBothSides && (event === "nichtantreten_team1" || event === "nichtantreten_team2") ? "beide Seiten nötig" : undefined;

  // A key outside this closed collection can only be a stale page, and dropping the pick would
  // discard a choice the admin made. The switch is the one way back to no event at all.
  const handleChange = (key: Key | null) => {
    const picked = SONDEREREIGNIS_OPTIONS.find((event) => event === key?.toString());
    if (picked !== undefined) onSonderereignisChange(picked);
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Sonderereignis
          {/* Written out rather than mapped, so `hintCap.test.ts` can measure it. The two Nichtantreten
              members are one line: the list is counted against what the reader can reach
              (`docs/frontend/spec.md` §1.12), and either is the same award. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Sonderereignis"
            body={{ lead: "Was mit dem Spiel geschehen ist, über das Spielen hinaus." }}
          />
        </h2>
      </div>

      <div className={styles.body()}>
        {/* A switch rather than a member of the select: `null` is the absence of an event, not a
            sixth kind of one, and a scalar has no empty-but-present value to open the select on. */}
        <Switch
          isSelected={hasSonderereignis}
          onChange={onHasSonderereignisChange}>
          {/* Named by its visible content: an `aria-label` would override it with a copy. */}
          <Switch.Content className={styles.switchContent()}>
            Sonderereignis eintragen
            <Switch.Control className={styles.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {/* Nothing pre-selected, `FormAustrittSection`'s rule: a seeded member files an event
            nobody chose, and `ausgefallen` would refuse goals that are already typed. */}
        {hasSonderereignis && (
          <Select
            // The switch asserts an event, so an empty pick is refused here, by the browser on submit:
            // the write path accepts `null` and has no rule to lend. Switching off is the way back to
            // no event.
            isRequired
            name="sonderereignis"
            value={sonderereignis ?? undefined}
            onChange={handleChange}
            isInvalid={status?.error ? true : undefined}
            className="w-full">
            <FieldLabel path="sonderereignis">Sonderereignis</FieldLabel>

            <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
              {/* From the prop rather than `Select.Value`, which resolves its label out of the
                  react-aria collection and shows HeroUI's English placeholder on a render where that
                  collection has not committed — `SaisonSelector`'s reason. */}
              <span className={sonderereignis === null ? "text-foreground-muted" : "text-danger-strong font-bold"}>
                {sonderereignis === null ? "Sonderereignis wählen" : SONDEREREIGNIS_LABELS[sonderereignis]}
              </span>
              <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
            </Select.Trigger>

            <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
              <ListBox aria-label="Sonderereignis">
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
        )}

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
