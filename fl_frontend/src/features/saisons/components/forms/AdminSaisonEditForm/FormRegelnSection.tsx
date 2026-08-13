"use client";

import { SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { StufenPicker } from "@/features/saisons/components/forms/StufenPicker";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SaisonFieldLabel } from "./SaisonFieldLabel";

import type { FLSaisonRules } from "@/features/saisons/schemas";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { SaisonBanner } from "./banners";

/**
 * The season's competition rules — the six fields of `rules`, and the only surface in the app that writes
 * any of them.
 *
 * **Three of them are read on paths that do not look like a form.** `win_points` and `draw_points` score
 * the league table on every read rather than being stored (ADR-0019), so a change here moves every
 * standing for this season the moment it saves and there is nothing to migrate.
 * `qualifiers_per_group` decides how many of each group reach the first knockout round, which is what the
 * seeding walk reads (ADR-0035). `number_of_groups` and `teams_per_group` bound what a club may be
 * entered into, and the junction write refuses an entry outside them.
 *
 * **`erlaubte_stufen` narrows what a squad form OFFERS and never what a stored row holds.** No validator
 * holds `saison_spieler.stufe` against a season's list, deliberately: a row's level is held to the
 * league's closed set (ADR-0048), so narrowing a season cannot retroactively invalidate the squads of a
 * season already played.
 */
export function FormRegelnSection({
  rules,
  onRulesChange,
  onFieldLeft,
  onStufenChange,
  stufenError,
  isFinishedSaison,
  banners,
}: {
  rules: FLSaisonRules;
  onRulesChange: (next: FLSaisonRules) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Separate from `onRulesChange`, because a picked control is judged on change (ADR-0040). */
  onStufenChange: (next: FLSpielerStufe[]) => void;
  stufenError?: string;
  /**
   * Whether this season is over, which freezes the three fields the league table is scored from
   * (`REQ-RULES-005`). The endpoint refuses a change to any of them; this stops the page offering one.
   */
  isFinishedSaison: boolean;
  /** The editor's whole Hinweis list; the two spots below take their own entries out of it. */
  banners: readonly SaisonBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Regeln
          <InfoHint label="Hinweis zu den Regeln">
            <p>Diese Werte legen fest, wie die Saison gespielt wird.</p>
            <ul>
              <li>
                <strong>Punkte</strong> gelten rückwirkend, auch für längst gespielte Spiele.
              </li>
              <li>
                <strong>Gruppen und Teams pro Gruppe</strong> begrenzen, wohin ein Team aufgenommen werden kann.
              </li>
              <li>
                <strong>Qualifikanten</strong> ist die Zahl pro Gruppe, die die KO-Runde erreicht.
              </li>
              <li>
                <strong>Stufen</strong> begrenzen nur, was Du künftig auswählen kannst. Bestehende Kadereinträge bleiben, wie sie sind.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Punkte</h3>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            <SaisonRuleNumberField
              name="rules.win_points"
              isReadOnly={isFinishedSaison}
              label={<SaisonFieldLabel path="rules.win_points">Sieg</SaisonFieldLabel>}
              minValue={1}
              value={rules.win_points}
              onChange={(win_points) => onRulesChange({ ...rules, win_points })}
              onBlur={() => onFieldLeft(["rules.win_points"])}
            />
            <SaisonRuleNumberField
              name="rules.draw_points"
              isReadOnly={isFinishedSaison}
              label={<SaisonFieldLabel path="rules.draw_points">Unentschieden</SaisonFieldLabel>}
              minValue={0}
              value={rules.draw_points}
              onChange={(draw_points) => onRulesChange({ ...rules, draw_points })}
              onBlur={() => onFieldLeft(["rules.draw_points"])}
            />
          </div>
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Aufbau</h3>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            <SaisonRuleNumberField
              name="rules.number_of_groups"
              label={<SaisonFieldLabel path="rules.number_of_groups">Gruppen</SaisonFieldLabel>}
              minValue={1}
              // The closed set is A to D and this picks a prefix of it, so 4 is the ceiling rather than a
              // policy — a fifth group has no letter to be.
              maxValue={4}
              value={rules.number_of_groups}
              onChange={(number_of_groups) => onRulesChange({ ...rules, number_of_groups })}
              onBlur={() => onFieldLeft(["rules.number_of_groups"])}
            />
            <SaisonRuleNumberField
              name="rules.teams_per_group"
              label={<SaisonFieldLabel path="rules.teams_per_group">Teams pro Gruppe</SaisonFieldLabel>}
              minValue={1}
              value={rules.teams_per_group}
              onChange={(teams_per_group) => onRulesChange({ ...rules, teams_per_group })}
              onBlur={() => onFieldLeft(["rules.teams_per_group"])}
            />
            <SaisonRuleNumberField
              name="rules.qualifiers_per_group"
              isReadOnly={isFinishedSaison}
              label={<SaisonFieldLabel path="rules.qualifiers_per_group">Qualifikanten</SaisonFieldLabel>}
              minValue={1}
              value={rules.qualifiers_per_group}
              onChange={(qualifiers_per_group) => onRulesChange({ ...rules, qualifiers_per_group })}
              onBlur={() => onFieldLeft(["rules.qualifiers_per_group"])}
            />
          </div>

          {/* Refused by `REQ-RULES-007` (decided 2026-08-08), and said here as well because the two fields
              that cause it are the two directly above: the seeding walk asks each group for this many
              placings, and a group that cannot produce them leaves the bracket short. */}
          <InlineBanners
            banners={banners}
            spot="regeln-qualifikanten"
          />
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Erlaubte Stufen</h3>
          <SaisonFieldLabel path="rules.erlaubte_stufen">Welche Stufen diese Saison spielen</SaisonFieldLabel>
          <StufenPicker
            value={rules.erlaubte_stufen}
            onChange={onStufenChange}
            error={stufenError}
          />
        </div>

        {/* Standing rather than announced: what the season's status does to a rules edit is true
            before the admin touches anything, and it is the same sentence the rail carries. */}
        <InlineBanners
          banners={banners}
          spot="regeln-status"
        />

        {/* Panel-local, and deliberately not a banner: which of THESE fields are frozen is a fact
            about the three inputs directly above, and on the rail it would describe controls the
            reader cannot see. Without it they are three inputs that will not take a value and no
            reason why. `REQ-RULES-005` is what refuses the change. */}
        {isFinishedSaison && (
          <p className="fluid-xxs text-foreground-muted font-medium">
            Punkte und Qualifikanten sind festgeschrieben. Gruppen, Teams pro Gruppe, Stufen und der Zeitraum bleiben änderbar.
          </p>
        )}
      </div>
    </section>
  );
}
