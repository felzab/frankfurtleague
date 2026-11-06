"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/kit/Button";
import { ConfirmDialog } from "@/kit/ConfirmDialog";
import { EmptyState } from "@/kit/EmptyState";
import { StatusCard } from "@/kit/StatusPage";
import { CheckStep, StepCard } from "@/kit/StepCard";
import { answering } from "@/kit/useFormAction";

import { COPY } from "@/core/copy";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { trikotFarbeLabel } from "@/features/teams/constants";

import { AcceptFields } from "../[bewerbung]/AcceptFields";
import { acceptBewerbung } from "../[bewerbung]/decideBewerbung";
import { cardOf, gruppenFor, openRows, outcomeOf } from "./run";

import type { FLBewerbungGruppeOffer, FLBewerbungListRow, FLTrikotFarbe } from "@/core/generated/client/types";
import type { AcceptRules } from "@/features/bewerbungen/fieldRules";
import type { Fact } from "@/kit/Facts";
import type { TableRow } from "@/kit/Table";
import type { Draft, Outcome, Run } from "./run";

const WORDS = COPY.admin.bewerbung;
const TITLE = COPY.page.adminBewerbungenBulk;
/** The address's name of the card a row or Back returns to. */
const CARD = "card";

const figure = (label: Fact["label"], value: number): Fact => ({ label, value: { record: formatNumber(value) }, figures: true });

/** The facts a card's group and colour are judged on. */
const factsOf = (row: FLBewerbungListRow): readonly Fact[] => [
  { label: WORDS.received, value: { record: formatDate(dayOf(row.submitted_at)) } },
  figure(COPY.team.stufengroesse, row.stufengroesse),
  figure(COPY.team.expectedKader, row.expected_kader),
  { label: COPY.team.wunschfarbe, value: { record: trikotFarbeLabel(row.wunschfarbe) } },
  { label: COPY.team.wunschgegner, value: row.wunschgegner === null ? COPY.shared.noValue : { record: row.wunschgegner } },
];

/** One application's write as the acceptance's form would post it. */
function formOf(row: FLBewerbungListRow, draft: Draft): FormData {
  const form = new FormData();
  form.set("id", row.id);
  form.set("version", String(row.version));
  form.set("gruppe", draft.gruppe);
  form.set("trikot_farbe", draft.trikot_farbe);
  form.set("shorthand", row.shorthand === null ? draft.shorthand : "");
  return form;
}

/** A row of the check page: entered with its chip, turned away with why and its way back, else what the run will write. */
function checkRow(row: FLBewerbungListRow, run: Run, outcome: Outcome | undefined, open: (id: string) => void): TableRow {
  const draft = run.drafts[row.id];
  const cells = {
    gruppe: draft === undefined ? COPY.shared.noValue : COPY.shared.season.gruppe(draft.gruppe),
    farbe:
      draft === undefined || draft.trikot_farbe === ""
        ? COPY.shared.notProvided
        : { record: trikotFarbeLabel(draft.trikot_farbe as FLTrikotFarbe) },
    shorthand: { record: row.shorthand ?? draft?.shorthand.toUpperCase() ?? "" },
  };
  const base = { id: row.id, name: { record: row.name }, cells };
  if (outcome?.kind === "accepted") return { ...base, chip: { tone: "success", label: WORDS.accepted } };
  const refused = outcome?.kind === "refused" ? outcome : null;
  const line = refused?.taken === true ? undefined : (refused?.line ?? Object.values(refused?.fieldErrors ?? {})[0]);
  return {
    ...base,
    onOpen: () => open(row.id),
    ...(refused?.taken === true ? { chip: { tone: "danger", label: WORDS.shorthandTaken } } : {}),
    ...(line === undefined ? {} : { refusal: line }),
  };
}

/**
 * The Sammel-Zusage: one card per complete, undecided application, each with its group, its colour and a new school's
 * code, or left out of the run; then a table of what the run will write, a row leading back to its card; one confirm;
 * and one write per application, each answering on its own row, what is entered staying entered. Where the run stands
 * moves through the address by the History API, so Back walks the cards without a read; what a card chose is held
 * here, and the run's applications are the ones it opened on, a write's fresh render changing neither.
 */
export function BulkAccept({
  saison,
  rows: served,
  gruppen,
  rules,
}: {
  saison: string;
  rows: readonly FLBewerbungListRow[];
  gruppen: readonly FLBewerbungGruppeOffer[];
  rules: AcceptRules;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const named = useSearchParams().get(CARD);
  const [rows] = useState(served);
  const [run, setRun] = useState<Run>({ drafts: {}, skipped: new Set(), outcomes: {} });

  const go = (card: string | null) => window.history.pushState(null, "", card === null ? pathname : `${pathname}?${CARD}=${card}`);

  if (rows.length === 0)
    return (
      <EmptyState
        kind="none"
        plural={COPY.page.adminBewerbungen}
        glyph="bewerbungen"
      />
    );

  const open = openRows(rows, run);
  const accepted = rows.filter((row) => run.outcomes[row.id]?.kind === "accepted").length;
  if (open.length === 0 && accepted > 0)
    return (
      <StatusCard
        tone="success"
        title={WORDS.acceptedCount(accepted)}
        next={{ label: COPY.shared.end.toTeams, href: ROUTES.adminTeams.path(saison) }}
      />
    );

  const leave = (next: Run) => {
    setRun(next);
    go(cardOf(rows, next, null)?.id ?? null);
  };

  const card = cardOf(rows, run, named);
  if (card !== null) {
    const outcome = run.outcomes[card.id];
    return (
      <StepCard
        key={card.id}
        title={{ record: card.name }}
        line={WORDS.cardOf(rows.filter((row) => !run.skipped.has(row.id)).indexOf(card) + 1, rows.length - run.skipped.size)}
        facts={factsOf(card)}
        fieldErrors={outcome?.kind === "refused" ? outcome.fieldErrors : undefined}
        onSkip={() => leave({ ...run, skipped: new Set(run.skipped).add(card.id) })}
        onNext={(form) => {
          const draft: Draft = {
            gruppe: String(form.get("gruppe") ?? ""),
            trikot_farbe: String(form.get("trikot_farbe") ?? ""),
            shorthand: String(form.get("shorthand") ?? ""),
          };
          // A changed card asks afresh: its old refusal speaks of what it held then.
          const { [card.id]: _answered, ...outcomes } = run.outcomes;
          leave({ ...run, drafts: { ...run.drafts, [card.id]: draft }, outcomes });
        }}>
        <AcceptFields
          subject={{ wish: card.wunschfarbe, shorthand: card.shorthand }}
          gruppen={gruppenFor(gruppen, rows, run, card.id)}
          rules={rules}
          picked={run.drafts[card.id]}
        />
      </StepCard>
    );
  }

  const confirm = async () => {
    // One after another, each its own transaction, so a refusal lands on its row and nothing entered is undone.
    for (const row of open) {
      const draft = run.drafts[row.id];
      if (draft === undefined) continue;
      const outcome = outcomeOf(await answering(acceptBewerbung, router.refresh)(formOf(row, draft)));
      setRun((current) => ({ ...current, outcomes: { ...current.outcomes, [row.id]: outcome } }));
    }
  };

  const shown = rows.filter((row) => !run.skipped.has(row.id));
  const count = open.length;
  return (
    <CheckStep
      table={{
        label: TITLE,
        nameLabel: COPY.shared.facts.school,
        columns: [
          { key: "gruppe", label: COPY.team.gruppe, narrow: true },
          { key: "farbe", label: COPY.team.trikotFarbe, hideOnPhone: true },
          { key: "shorthand", label: COPY.team.shorthand, hideOnPhone: true },
        ],
        rows: shown.map((row) => checkRow(row, run, run.outcomes[row.id], go)),
        empty: { kind: "none", plural: COPY.page.adminBewerbungen, glyph: "bewerbungen" },
      }}
      refused={open.some((row) => run.outcomes[row.id]?.kind === "refused")}
      act={
        count === 0 ? null : (
          <ConfirmDialog
            verb="accept"
            subject={WORDS.count(count)}
            consequence={WORDS.acceptManyConsequence(saison)}
            facts={[{ label: COPY.admin.facts.mailTo, value: WORDS.kontaktCount(open.reduce((sum, row) => sum + row.people, 0)) }]}
            tone="primary"
            onConfirm={confirm}
            trigger={
              <Button
                variant="primary"
                label={COPY.shared.withObject(WORDS.count(count), "accept")}
              />
            }
          />
        )
      }
    />
  );
}
