"use client";

import { useState } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { Card, CardPlaceholder } from "./Card";
import { Facts, FactsPlaceholder } from "./Facts";
import { FieldStack } from "./FieldStack";
import { FormFooter, FormFooterPlaceholder } from "./FormFooter";
import { HeldForm } from "./HeldForm";
import { Table } from "./Table";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { Fact } from "./Facts";
import type { TableProps } from "./Table";

const stepCard = tv({ slots: { body: "grid gap-4" } });

/**
 * One record of a run in its card, as the record's list row is one line: its name, where it stands in the run, the facts
 * its inputs are judged on, then its inputs, each holding its own value until „Weiter“ hands them over. The browser's
 * rules hold the press back, the status line pointing at the fields. A caller keys the card on its record, so the next
 * record's card opens on its own values.
 */
export function StepCard({
  title,
  line,
  facts,
  fieldErrors,
  onNext,
  onSkip,
  children,
}: {
  title: Words;
  line: Copy;
  facts: ReadonlyArray<Fact>;
  /** What an earlier send refused, each message on its box. */
  fieldErrors?: Readonly<Record<string, Copy>>;
  onNext: (form: FormData) => void;
  onSkip: () => void;
  children: ReactNode;
}) {
  const [isBlocked, setBlocked] = useState(false);
  const { body } = stepCard();
  return (
    <Card
      title={title}
      line={line}
      body="fields">
      <HeldForm
        className={body()}
        validationErrors={fieldErrors}
        onInvalid={() => setBlocked(true)}
        onSend={onNext}>
        <Facts facts={facts} />
        <FieldStack>{children}</FieldStack>
        <FormFooter status={isBlocked ? { tone: "error", text: COPY.template.checkFields } : null}>
          <Button
            variant="quiet"
            label={COPY.shared.verb.skip}
            onPress={onSkip}
          />
          <Button
            variant="primary"
            type="submit"
            label={COPY.shared.verb.next}
            onPress={() => setBlocked(false)}
          />
        </FormFooter>
      </HeldForm>
    </Card>
  );
}

/** A record's card while the run is read: its head, `facts` of its facts, its inputs' placeholders and its acts. */
export function StepCardPlaceholder({ facts, children }: { facts: number; children: ReactNode }) {
  const { body } = stepCard();
  return (
    <CardPlaceholder
      line
      body="fields">
      <div className={body()}>
        <FactsPlaceholder pairs={facts} />
        <FieldStack>{children}</FieldStack>
        <FormFooterPlaceholder>
          <span className={buttonPlaceholder()}>{COPY.shared.verb.skip}</span>
          <span className={buttonPlaceholder()}>{COPY.shared.verb.next}</span>
        </FormFooterPlaceholder>
      </div>
    </CardPlaceholder>
  );
}

/**
 * A run's check page: a row per record, each leading back to its card, the line saying why a refused one needs that, and
 * the one act confirming the whole run in its footer, as wide as the column on a phone.
 */
export function CheckStep({ table, refused, act }: { table: TableProps; refused: boolean; act: ReactElement | null }) {
  return (
    <>
      <Table {...table} />
      <FormFooter status={refused ? { tone: "error", text: COPY.template.checkFields } : null}>{act}</FormFooter>
    </>
  );
}
