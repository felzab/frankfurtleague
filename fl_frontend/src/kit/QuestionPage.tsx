import { QuestionForm } from "./QuestionForm";
import { RailPage } from "./RailFrame";
import { TextField } from "./TextField";

import type { ComponentProps, ReactNode } from "react";
import type { PageTitle } from "./RailFrame";
import type { TextFieldProps } from "./TextField";

type Form<Input> = Omit<ComponentProps<typeof QuestionForm<Input>>, "holder" | "children">;

type Fields = {
  /** The form's text fields, in their order, each with its `name`. */
  fields: ReadonlyArray<TextFieldProps>;
  /** The fields that are not text, such as boxes to tick, under the text fields, each the kit's with its `name`. */
  children?: ReactNode;
};

async function FormOnceRead<Input>({ holder, fields, children, ...form }: Form<Input> & Fields & { holder: Promise<string> }) {
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
      {children}
    </QuestionForm>
  );
}

/**
 * A page that is one question: the title in the strip and under it `QuestionForm` with its fields, nothing listed beside
 * it. `holder` is a promise the form awaits, whose read also turns a refused session away.
 */
export function QuestionPage<Input>({
  title,
  holder,
  fields,
  children,
  ...form
}: Form<Input> &
  Fields & {
    title: PageTitle;
    /** The address the page is drawn for, as `QuestionForm` takes it. */
    holder: Promise<string>;
  }) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <FormOnceRead
        {...form}
        holder={holder}
        fields={fields}>
        {children}
      </FormOnceRead>
    </RailPage>
  );
}
