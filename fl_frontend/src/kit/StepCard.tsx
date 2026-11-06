"use client";

import { useState } from "react";

import { Form } from "react-aria-components/Form";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { buttonPlaceholder } from "./buttonStyles";
import { Card, CardPlaceholder } from "./Card";
import { ActRow } from "./Dialog";
import { Facts, FactsPlaceholder } from "./Facts";
import { StatusLine } from "./FieldParts";
import { statusLine } from "./fieldStyles";
import { Table } from "./Table";
import { tv } from "./tv";
import { formSend } from "./useFormAction";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { Fact } from "./Facts";
import type { TableProps } from "./Table";

const stepCard = tv({ slots: { body: "grid gap-4", inputs: "grid justify-items-start gap-4" } });

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
  const { body, inputs } = stepCard();
  return (
    <Card
      title={title}
      line={line}
      body="fields">
      <Form
        className={body()}
        validationErrors={fieldErrors}
        onInvalid={() => setBlocked(true)}
        {...formSend(onNext)}>
        <Facts facts={facts} />
        <div className={inputs()}>{children}</div>
        <ActRow>
          <StatusLine
            status={isBlocked ? { tone: "error", text: COPY.template.checkFields } : null}
            placement="row"
          />
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
        </ActRow>
      </Form>
    </Card>
  );
}

/** A record's card while the run is read: its head, `facts` of its facts, its inputs' placeholders and its acts. */
export function StepCardPlaceholder({ facts, children }: { facts: number; children: ReactNode }) {
  const { body, inputs } = stepCard();
  return (
    <CardPlaceholder
      line
      body="fields">
      <div className={body()}>
        <FactsPlaceholder pairs={facts} />
        <div className={inputs()}>{children}</div>
        <ActRow>
          <span className={statusLine({ placement: "row" })} />
          <span className={buttonPlaceholder()}>{COPY.shared.verb.skip}</span>
          <span className={buttonPlaceholder()}>{COPY.shared.verb.next}</span>
        </ActRow>
      </div>
    </CardPlaceholder>
  );
}

/**
 * A run's check page: a row per record, each leading back to its card, the line saying why a refused one needs that, and
 * the one act confirming the whole run, as wide as the column on a phone.
 */
export function CheckStep({ table, refused, act }: { table: TableProps; refused: boolean; act: ReactElement | null }) {
  return (
    <>
      <Table {...table} />
      <div className="grid gap-3 lg:flex lg:items-center">
        {act}
        <StatusLine
          status={refused ? { tone: "error", text: COPY.template.checkFields } : null}
          placement="row"
        />
      </div>
    </>
  );
}
