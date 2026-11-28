import { QuestionForm } from "./QuestionForm";
import { RailPage } from "./RailFrame";

import type { ActionAnswer } from "@/core/action";
import type { ComponentProps } from "react";
import type { PageTitle } from "./RailFrame";

/** The form's props but its act, its fields among them as `children`. */
type Form<Input> = Omit<ComponentProps<typeof QuestionForm<Input>>, "touch" | "run">;

/**
 * The page's act: `touch` for one on the touch's fixed list, which the form asks for `holder` once read, a promise the
 * form's `touch` cannot take.
 */
type PageRun<Input> =
  | { touch: true; run: (input: NoInfer<Input> & { holder: string }) => Promise<ActionAnswer> }
  | { touch?: never; run: (input: NoInfer<Input>) => Promise<ActionAnswer> };

/** The page's form, its holder read: the read that turns a refused session away awaited on every page, touched or not. */
async function FormOnceRead<Input>({ holder, ...page }: Form<Input> & PageRun<Input> & { holder: Promise<string> }) {
  const address = await holder;
  if (page.touch === true) {
    return (
      <QuestionForm
        {...page}
        touch={{ holder: address }}
      />
    );
  }
  return <QuestionForm {...page} />;
}

/**
 * A page that is one question: the title in the strip and under it `QuestionForm` with its fields, nothing listed beside
 * it. `holder` is a promise the form awaits, whose read also turns a refused session away.
 */
export function QuestionPage<Input>({
  title,
  ...form
}: Form<Input> &
  PageRun<Input> & {
    title: PageTitle;
    /** The address the page is drawn for, which a touched act's touch answers for. */
    holder: Promise<string>;
  }) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <FormOnceRead {...form} />
    </RailPage>
  );
}
