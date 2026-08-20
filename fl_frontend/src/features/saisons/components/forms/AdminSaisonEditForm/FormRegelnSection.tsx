"use client";

import { Label } from "@heroui/react";

import { SaisonRuleNumberField, SaisonTiebreakSelect } from "@/features/saisons/components/forms/SaisonFormControls";
import { StufenPicker } from "@/features/saisons/components/forms/StufenPicker";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { FLSaisonRules } from "@/features/saisons/schemas";
import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { SaisonBanner } from "./banners";

/**
 * **`erlaubte_stufen` narrows what a squad form OFFERS and never what a stored row holds.** No
 * validator holds `saison_spieler.stufe` against a season's list, deliberately: narrowing a season
 * must not retroactively invalidate a season already played.
 */
export function FormRegelnSection({
  rules,
  onRulesChange,
  onFieldLeft,
  onStufenChange,
  isFinishedSaison,
  isDrawnSaison,
  banners,
}: {
  rules: FLSaisonRules;
  onRulesChange: (next: FLSaisonRules) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Separate from `onRulesChange`, because a picked control is judged on change. */
  onStufenChange: (next: FLSpielerStufe[]) => void;
  /**
   * Whether this season is over, which freezes the four fields the league table is scored from
   * (`REQ-RULES-005`). The endpoint refuses a change to any of them; this stops the page offering one.
   */
  isFinishedSaison: boolean;
  /**
   * Whether the season's fixtures exist, which freezes the three they were drawn from
   * (`REQ-RULES-011`). Not a later stage of the freeze above: a season is drawn long before it is
   * over, and `qualifiers_per_group` is in both.
   */
  isDrawnSaison: boolean;
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
                <strong>Punkte</strong> gelten rückwirkend, auch für längst gespielte Spiele. In einer abgeschlossenen Saison sind sie deshalb
                festgeschrieben.
              </li>
              <li>
                <strong>Bei Punktgleichheit</strong> legst Du fest, welche Zahl zwei gleichauf liegende Teams zuerst trennt.
              </li>
              <li>
                <strong>Nichtantreten</strong> ist das Ergebnis, mit dem ein Spiel gewertet wird, zu dem ein Team nicht erscheint.
              </li>
              <li>
                <strong>Gruppen und Teams pro Gruppe</strong> begrenzen, wohin ein Team aufgenommen werden kann.
              </li>
              <li>
                <strong>Qualifikanten</strong> ist die Zahl pro Gruppe, die die KO-Runde erreicht.
              </li>
              <li>
                <strong>Maximale Kadergröße</strong> begrenzt, wie viele Spieler ein Team in dieser Saison aufbieten darf.
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
          <div className={FIELD_PAIR}>
            <SaisonRuleNumberField
              name="rules.win_points"
              isReadOnly={isFinishedSaison}
              label={<FieldLabel path="rules.win_points">Sieg</FieldLabel>}
              minValue={1}
              value={rules.win_points}
              onChange={(win_points) => onRulesChange({ ...rules, win_points })}
              onBlur={() => onFieldLeft(["rules.win_points"])}
            />
            <SaisonRuleNumberField
              name="rules.draw_points"
              isReadOnly={isFinishedSaison}
              label={<FieldLabel path="rules.draw_points">Unentschieden</FieldLabel>}
              minValue={0}
              value={rules.draw_points}
              onChange={(draw_points) => onRulesChange({ ...rules, draw_points })}
              onBlur={() => onFieldLeft(["rules.draw_points"])}
            />
          </div>
          <SaisonTiebreakSelect
            name="rules.tiebreak_order"
            isDisabled={isFinishedSaison}
            label={<FieldLabel path="rules.tiebreak_order">Bei Punktgleichheit entscheidet</FieldLabel>}
            value={rules.tiebreak_order}
            onChange={(tiebreak_order) => onRulesChange({ ...rules, tiebreak_order })}
          />
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Wertung bei Nichtantreten</h3>
          {/* One label over the pair, mirroring its one row in the change list: the season regulates
              both sides' goals together, so neither number is a decision on its own. */}
          <FieldLabel path="rules.forfeit_ergebnis">Ergebnis eines Spiels, zu dem ein Team nicht antritt</FieldLabel>
          <div className={FIELD_PAIR}>
            <SaisonRuleNumberField
              name="rules.forfeit_ergebnis.sieger_tore"
              label={<Label className={FIELD_LABEL}>Tore für den Sieger</Label>}
              minValue={0}
              value={rules.forfeit_ergebnis.sieger_tore}
              onChange={(sieger_tore) => onRulesChange({ ...rules, forfeit_ergebnis: { ...rules.forfeit_ergebnis, sieger_tore } })}
              onBlur={() => onFieldLeft(["rules.forfeit_ergebnis.sieger_tore"])}
            />
            <SaisonRuleNumberField
              name="rules.forfeit_ergebnis.verlierer_tore"
              label={<Label className={FIELD_LABEL}>Tore für den Verlierer</Label>}
              minValue={0}
              value={rules.forfeit_ergebnis.verlierer_tore}
              onChange={(verlierer_tore) => onRulesChange({ ...rules, forfeit_ergebnis: { ...rules.forfeit_ergebnis, verlierer_tore } })}
              onBlur={() => onFieldLeft(["rules.forfeit_ergebnis.verlierer_tore"])}
            />
          </div>
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Aufbau</h3>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            <SaisonRuleNumberField
              name="rules.number_of_groups"
              isReadOnly={isDrawnSaison}
              label={<FieldLabel path="rules.number_of_groups">Gruppen</FieldLabel>}
              minValue={1}
              // The closed set is A to D and this picks a prefix, so 4 is a ceiling rather than a policy.
              maxValue={4}
              value={rules.number_of_groups}
              onChange={(number_of_groups) => onRulesChange({ ...rules, number_of_groups })}
              onBlur={() => onFieldLeft(["rules.number_of_groups"])}
            />
            <SaisonRuleNumberField
              name="rules.teams_per_group"
              isReadOnly={isDrawnSaison}
              label={<FieldLabel path="rules.teams_per_group">Teams pro Gruppe</FieldLabel>}
              // Below 2 a group generates no fixture; above 16 a season-scoped read is truncated and
              // the refusals over it cannot be trusted.
              minValue={2}
              maxValue={16}
              value={rules.teams_per_group}
              onChange={(teams_per_group) => onRulesChange({ ...rules, teams_per_group })}
              onBlur={() => onFieldLeft(["rules.teams_per_group"])}
            />
            {/* The one field both freezes reach: the table is scored from it and the fixtures were
                drawn from it, so either condition alone closes it. */}
            <SaisonRuleNumberField
              name="rules.qualifiers_per_group"
              isReadOnly={isFinishedSaison || isDrawnSaison}
              label={<FieldLabel path="rules.qualifiers_per_group">Qualifikanten</FieldLabel>}
              minValue={1}
              value={rules.qualifiers_per_group}
              onChange={(qualifiers_per_group) => onRulesChange({ ...rules, qualifiers_per_group })}
              onBlur={() => onFieldLeft(["rules.qualifiers_per_group"])}
            />
          </div>

          {/* Refused by `REQ-RULES-007`, and said here because the two fields that cause it are
              directly above: the seeding walk asks each group for this many placings, and a group
              that cannot produce them leaves the bracket short. */}
          <InlineBanners
            banners={banners}
            spot="regeln-qualifikanten"
          />
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Kader</h3>
          <SaisonRuleNumberField
            name="rules.max_kadergroesse"
            label={<FieldLabel path="rules.max_kadergroesse">Maximale Kadergröße</FieldLabel>}
            minValue={1}
            value={rules.max_kadergroesse}
            onChange={(max_kadergroesse) => onRulesChange({ ...rules, max_kadergroesse })}
            onBlur={() => onFieldLeft(["rules.max_kadergroesse"])}
          />
        </div>

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Erlaubte Stufen</h3>
          <FieldLabel path="rules.erlaubte_stufen">Welche Stufen diese Saison spielen</FieldLabel>
          <StufenPicker
            name="rules.erlaubte_stufen"
            value={rules.erlaubte_stufen}
            onChange={onStufenChange}
          />
        </div>

        {/* Standing rather than announced: what the season's status does to a rules edit is true
            before the admin touches anything, and it is the same sentence the rail carries. */}
        <InlineBanners
          banners={banners}
          spot="regeln-status"
        />

        {/* Panel-local, not a banner: which of THESE fields are frozen is a fact about the inputs
            directly above, and on the rail it would describe controls the reader cannot see. One
            sentence per freeze, the two arriving on different events. */}
        {(isFinishedSaison || isDrawnSaison) && (
          <div className="fluid-xxs text-foreground-muted flex w-full flex-col gap-y-1 font-medium">
            {isFinishedSaison && (
              <p>
                Die Saison ist abgeschlossen, deshalb sind Punkte, die Reihenfolge bei Punktgleichheit und die Qualifikanten festgeschrieben.
              </p>
            )}
            {isDrawnSaison && (
              <p>
                Für diese Saison sind schon Spiele angesetzt, und sie sind aus diesen Zahlen entstanden. Gruppen, Teams pro Gruppe und
                Qualifikanten stehen damit fest. Andere Zahlen würden einen neuen Spielplan verlangen, und Spiele legt die Verwaltung nicht an.
              </p>
            )}
            {/* Spelled out per case rather than listing the always-open fields: under one freeze the
                other's fields are still editable, and leaving them out would read as closing them. */}
            <p>
              {isFinishedSaison && isDrawnSaison
                ? "Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar."
                : isFinishedSaison
                  ? "Gruppen, Teams pro Gruppe, Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar."
                  : "Punkte, die Reihenfolge bei Punktgleichheit, Nichtantreten, Kadergröße, Stufen und der Zeitraum bleiben änderbar."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
