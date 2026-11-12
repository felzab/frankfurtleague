import { Suspense } from "react";

import { FieldPlaceholder } from "./FieldPair";
import { QuestionForm, QuestionFormPlaceholder } from "./QuestionForm";
import { RailPage } from "./RailFrame";
import { TextField } from "./TextField";

import type { ComponentProps } from "react";
import type { PageTitle } from "./RailFrame";
import type { TextFieldProps } from "./TextField";

type Form<Input> = Omit<ComponentProps<typeof QuestionForm<Input>>, "holder" | "children">;

/** The form once the address it is drawn for is read. */
async function FormOnceRead<Input>({
  holder,
  fields,
  ...form
}: Form<Input> & { holder: Promise<string>; fields: ReadonlyArray<TextFieldProps> }) {
  return (
    <QuestionForm
      {...form}
      holder={await holder}>
      {fields.map((field) => (
        <TextField
          key={field.name}
          {...field}
        />
      ))}
    </QuestionForm>
  );
}

/**
 * A page that is one question: the title in the strip and under it `QuestionForm`, nothing listed beside it. The fields
 * are data rather than elements, so the wait draws each one's placeholder from what the form will draw and the two
 * cannot part. `holder` is a promise, read inside the page's one boundary, which also turns a refused session away.
 */
export function QuestionPage<Input>({
  title,
  holder,
  fields,
  ...form
}: Form<Input> & {
  title: PageTitle;
  /** The address the page is drawn for, as `QuestionForm` takes it. */
  holder: Promise<string>;
  /** The form's fields, in their order, each with its `name`. */
  fields: ReadonlyArray<TextFieldProps>;
}) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <Suspense
        fallback={
          <QuestionFormPlaceholder verb={form.verb}>
            {fields.map((field) => (
              <FieldPlaceholder
                key={field.name}
                {...(field.holds === undefined
                  ? { kind: field.kind === "paragraph" ? "paragraph" : "field" }
                  : { holds: field.holds, ...(field.unit === undefined ? {} : { unit: field.unit }) })}
                {...(field.description === undefined ? {} : { description: field.description })}
              />
            ))}
          </QuestionFormPlaceholder>
        }>
        <FormOnceRead
          {...form}
          holder={holder}
          fields={fields}
        />
      </Suspense>
    </RailPage>
  );
}
