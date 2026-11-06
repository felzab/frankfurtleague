"use client";

import { useState } from "react";

import { Form } from "react-aria-components/Form";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Card } from "./Card";
import { ActRow } from "./Dialog";
import { Facts } from "./Facts";
import { StatusLine } from "./FieldParts";
import { Table } from "./Table";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { Fact } from "./Facts";
import type { TableProps } from "./Table";

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
  return (
    <Card
      title={title}
      line={line}
      body="fields">
      <Form
        className="grid gap-4"
        validationErrors={fieldErrors}
        onInvalid={() => setBlocked(true)}
        onSubmit={(event) => {
          event.preventDefault();
          onNext(new FormData(event.currentTarget));
        }}>
        <Facts facts={facts} />
        <div className="grid justify-items-start gap-4">{children}</div>
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
