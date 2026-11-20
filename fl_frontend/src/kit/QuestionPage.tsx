import { QuestionForm } from "./QuestionForm";
import { RailPage } from "./RailFrame";

import type { ComponentProps } from "react";
import type { PageTitle } from "./RailFrame";

/** The form's props, its fields among them as `children`. */
type Form<Input> = Omit<ComponentProps<typeof QuestionForm<Input>>, "holder">;

async function FormOnceRead<Input>({ holder, ...form }: Form<Input> & { holder: Promise<string> }) {
  return (
    <QuestionForm
      {...form}
      holder={await holder}
    />
  );
}

/**
 * A page that is one question: the title in the strip and under it `QuestionForm` with its fields, nothing listed beside
 * it. `holder` is a promise the form awaits, whose read also turns a refused session away.
 */
export function QuestionPage<Input>({
  title,
  holder,
  ...form
}: Form<Input> & {
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
      />
    </RailPage>
  );
}
