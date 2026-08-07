"use client";

import { useState, useTransition } from "react";

import { Button, Form } from "@heroui/react";

import { patchTeamAction } from "@/features/teams/actions";
import { TeamFormFields } from "@/features/teams/components/forms/TeamFormFields";
import { FLPatchTeamPayloadSchema } from "@/features/teams/schemas";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { useDraftValidation } from "@/shared/hooks/useDraftValidation";
import { hasFieldErrors, useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import type { FLPatchTeamPayload, FLTeam } from "@/features/teams/schemas";

/** The save toast's second line — the fan-out is the half of the endpoint that fails silently. */
function describeFanOut(count: number): string {
  if (count === 0) return "Kein Spiel trägt eine Kopie — nichts nachzuziehen.";
  if (count === 1) return "Name und Kürzel wurden in 1 Spiel nachgezogen.";
  return `Name und Kürzel wurden in ${count} Spielen nachgezogen.`;
}

/**
 * The club's own fields, as one panel of the team page (ADR-0050): typed fields are judged when
 * they are left, with the same schema the server action parses, and the browser's newer verdicts
 * retract the server's older complaints without touching its map.
 *
 * **The save toast states the fan-out count.** `PATCH /teams/{team_id}` rewrites the name and
 * shorthand embedded in every match the club plays (ADR-0028 rule 3) — a write that changes
 * documents the caller never named, whose failures are invisible unless the count is surfaced.
 */
export function TeamStammdatenPanel({ team }: { team: FLTeam }) {
  const panel = formPanel();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<FLPatchTeamPayload>({
    id: team.id,
    name: team.name,
    shorthand: team.shorthand,
    description: team.description,
    full_name: team.full_name,
    website_url: team.website_url,
    address: team.address,
  });

  const { validatePaths, clearVerdicts, mergedWith } = useDraftValidation(FLPatchTeamPayloadSchema);
  const { fieldErrors, setFieldErrors, formRef } = useServerFieldErrors(() =>
    appToast.danger("Speichern fehlgeschlagen", {
      description: "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt. Bitte lade die Seite neu.",
    }),
  );

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await patchTeamAction(draft);

      if (!res.success) {
        setFieldErrors(res.fieldErrors ?? {});
        if (!hasFieldErrors(res.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
        }
        return;
      }

      setFieldErrors({});
      clearVerdicts();
      appToast.success("Verein gespeichert", { description: describeFanOut(res.fanned_out_to_spiele ?? 0) });
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h3 className={panel.heading()}>Stammdaten</h3>
      </div>
      <Form
        ref={formRef}
        validationErrors={mergedWith(fieldErrors)}
        action={handleSubmit}
        className={panel.body()}>
        <TeamFormFields
          draft={draft}
          onChange={setDraft}
          onFieldLeft={(paths) => validatePaths(draft, paths)}
        />

        <div className="flex w-full flex-row justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            isDisabled={isPending}
            className={formButton({ intent: "submit" })}>
            {isPending ? "Speichert..." : "Stammdaten speichern"}
          </Button>
        </div>
      </Form>
    </section>
  );
}
