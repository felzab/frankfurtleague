"use client";

import { useState, useTransition } from "react";

import { parseDate } from "@internationalized/date";

import { Button, Calendar, DateField, DatePicker, FieldError, Form, Input, Label, Separator, Switch, TextField } from "@heroui/react";

import { patchSaisonTeamAction, postSaisonTeamAction } from "@/features/teams/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { FLPatchSaisonTeamPayloadSchema } from "@/features/teams/schemas";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_GROUP, FIELD_INPUT, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import type { FLGruppenNames } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";
import type { CalendarDate } from "@internationalized/date";

/**
 * One season's membership, editable in place.
 *
 * A member season edits the two junction fields `PATCH /teams/{team_id}/saisons/{saison_id}`
 * replaces wholesale: the group, and the disqualification record. The record travels WHOLE — the
 * payload requires `disqualifikation` with no default, so lifting one sends an explicit `null` and
 * a form that forgot the field would be a 422, never a team quietly reinstated (ADR-0059).
 *
 * A season without a row offers exactly one thing: entering the club, with a group. There is no
 * control to leave a season and none may be added — disqualification is the only way out
 * (ADR-0033), which is why the DQ editor lives here and not beside a delete.
 */
function SaisonMembershipSection({ teamId, membership, today }: { teamId: string; membership: TeamSaisonMembership; today: string }) {
  const isMember = membership.membership !== null;
  const [isPending, startTransition] = useTransition();

  const [gruppe, setGruppe] = useState<FLGruppenNames | null>(membership.membership?.gruppe ?? null);
  const [isDisqualified, setIsDisqualified] = useState(membership.membership?.disqualifikation != null);
  const [grund, setGrund] = useState(membership.membership?.disqualifikation?.grund ?? "");
  const [datum, setDatum] = useState<CalendarDate | null>(() => {
    const stored = membership.membership?.disqualifikation?.datum;
    return stored ? parseDate(stored) : null;
  });

  const { validatePaths, clearVerdicts, mergedWith } = useDraftValidation(FLPatchSaisonTeamPayloadSchema);
  const { fieldErrors, setFieldErrors, formRef } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Bitte lade die Seite neu.",
    }),
  );

  const buildPatchPayload = () => ({
    team_id: teamId,
    saison_id: membership.saisonId,
    gruppe,
    disqualifikation: isDisqualified ? { grund, datum: datum ? datum.toString() : "" } : null,
  });

  const handleEnterSaison = () => {
    startTransition(async () => {
      const res = await postSaisonTeamAction({ team_id: teamId, saison_id: membership.saisonId, gruppe });

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Aufnehmen fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
        }
        return;
      }

      setFieldErrors({});
      appToast.success(res.message ?? "Mannschaft aufgenommen!");
    });
  };

  const handleSaveMembership = () => {
    startTransition(async () => {
      const res = await patchSaisonTeamAction(buildPatchPayload());

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
        }
        return;
      }

      setFieldErrors({});
      clearVerdicts();
      appToast.success("Saison-Zugehörigkeit gespeichert", {
        description:
          res.saison_team?.disqualifikation != null
            ? "Die Disqualifikation ist sofort auf jeder Seite sichtbar — Tabelle, Spiele und Teamseite lesen denselben Eintrag."
            : undefined,
      });
    });
  };

  // The switch is a PICKED control, judged on change (ADR-0050). Turning it ON seeds the record with
  // today — the common case for "took effect" — and turning it OFF is only a draft state: the lift
  // happens at save time, as the explicit `null` the payload requires.
  const handleDisqualifiedChange = (next: boolean) => {
    setIsDisqualified(next);
    if (next && datum === null) setDatum(parseDate(today));
  };

  return (
    <Form
      ref={formRef}
      validationErrors={mergedWith(fieldErrors)}
      action={isMember ? handleSaveMembership : handleEnterSaison}
      className="flex w-full flex-col gap-y-4">
      <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className={FORM_SECTION_HEADING}>Saison {membership.saisonId}</h4>
        {membership.saisonStatus === "active" && <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>}
        {membership.saisonStatus === "future" && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Geplant</span>}
        {!isMember && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht aufgenommen</span>}
      </div>

      {isMember ? (
        <>
          <div className="grid w-full grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <GruppeSelect
              value={gruppe}
              onChange={(next) => {
                setGruppe(next);
                validatePaths({ ...buildPatchPayload(), gruppe: next }, ["gruppe"]);
              }}
            />

            <div className="flex h-full flex-col justify-end pb-2">
              <Switch
                size="md"
                isSelected={isDisqualified}
                onChange={handleDisqualifiedChange}>
                <Switch.Content className="fluid-sm text-danger flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
                  Disqualifiziert
                  <Switch.Control className={isDisqualified ? "bg-danger" : ""}>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </div>
          </div>

          {isDisqualified && (
            <>
              <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <TextField
                  isRequired
                  name="disqualifikation.grund"
                  value={grund}
                  onChange={setGrund}
                  onBlur={() => validatePaths(buildPatchPayload(), ["disqualifikation.grund"])}>
                  <Label className={FIELD_LABEL}>Grund</Label>
                  <Input
                    placeholder="z.B. Rückzug nach dem 3. Spieltag"
                    className={FIELD_INPUT}
                  />
                  <FieldError className={FIELD_ERROR} />
                </TextField>

                <DatePicker
                  value={datum}
                  onChange={setDatum}
                  onBlur={() => validatePaths(buildPatchPayload(), ["disqualifikation.datum"])}
                  name="disqualifikation.datum"
                  className="w-full">
                  <Label className={FIELD_LABEL}>Wirksam ab</Label>
                  <DateField.Group
                    fullWidth
                    className={FIELD_GROUP}>
                    <DateField.Input className="fluid-sm">
                      {(segment) => (
                        <DateField.Segment
                          segment={segment}
                          className="data-[type=literal]:text-foreground-muted"
                        />
                      )}
                    </DateField.Input>
                    <DateField.Suffix>
                      <DatePicker.Trigger>
                        <DatePicker.TriggerIndicator />
                      </DatePicker.Trigger>
                    </DateField.Suffix>
                  </DateField.Group>
                  <FieldError className={FIELD_ERROR} />
                  <DatePicker.Popover className="p-2">
                    <Calendar
                      aria-label="Wirksamkeitsdatum auswählen"
                      className={`${overlayPanel()} p-3`}>
                      <Calendar.Header className="bg-transparent">
                        <Calendar.YearPickerTrigger>
                          <Calendar.YearPickerTriggerHeading />
                          <Calendar.YearPickerTriggerIndicator />
                        </Calendar.YearPickerTrigger>
                        <Calendar.NavButton slot="previous" />
                        <Calendar.NavButton slot="next" />
                      </Calendar.Header>
                      <Calendar.Grid>
                        <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                        <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
                      </Calendar.Grid>
                      <Calendar.YearPickerGrid>
                        <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
                      </Calendar.YearPickerGrid>
                    </Calendar>
                  </DatePicker.Popover>
                </DatePicker>
              </div>

              <Callout
                severity="warning"
                title="Der Grund ist öffentlich">
                Er erscheint als eingegebener Text auf der Teamseite und als Hinweis an jedem Spiel der Mannschaft. Die Tabelle überspringt die
                Mannschaft bei der Platzvergabe, ihre Ergebnisse bleiben gewertet.
              </Callout>
            </>
          )}

          {membership.membership?.disqualifikation != null && !isDisqualified && (
            <Callout
              severity="info"
              title="Disqualifikation wird beim Speichern aufgehoben">
              Der gespeicherte Grund und das Datum werden dabei entfernt — es gibt keinen Verlauf, aus dem sie wiederherstellbar wären.
            </Callout>
          )}

          <div className="flex w-full flex-row justify-end">
            <Button
              type="submit"
              variant="primary"
              isDisabled={isPending}
              className={formButton({ intent: "submit" })}>
              {isPending ? "Speichert..." : `Saison ${membership.saisonId} speichern`}
            </Button>
          </div>
        </>
      ) : (
        <div className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <GruppeSelect
            value={gruppe}
            onChange={setGruppe}
          />
          <Button
            type="submit"
            variant="primary"
            isDisabled={isPending}
            className={formButton({ intent: "submit" })}>
            {isPending ? "Speichert..." : "Aufnehmen"}
          </Button>
        </div>
      )}
    </Form>
  );
}

/**
 * The season-membership panel of the team page — the junction editor, and the disqualification
 * record's UI home (ADR-0059). One section per season, newest first, each saving its own row: the
 * junction is addressed per season, and one save button over N seasons would need a transaction the
 * API does not offer.
 *
 * This is also what makes the rollover's team step cheap (FB-6): the incoming season appears here as
 * "Nicht aufgenommen" while it is still `future`, one `Aufnehmen` per club.
 */
export function SaisonMembershipPanel({ teamId, memberships, today }: { teamId: string; memberships: TeamSaisonMembership[]; today: string }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h3 className={panel.heading()}>Saison-Zugehörigkeit</h3>
        <p className="fluid-xs text-foreground-muted font-medium">
          Eine Mannschaft verlässt eine Saison nie — der einzige Weg hinaus ist die Disqualifikation.
        </p>
      </div>
      <div className={panel.body()}>
        {memberships.map((membership, index) => (
          <div
            key={membership.saisonId}
            className="flex w-full flex-col gap-y-4">
            {index > 0 && <Separator className="bg-border" />}
            <SaisonMembershipSection
              teamId={teamId}
              membership={membership}
              today={today}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
