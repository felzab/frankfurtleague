// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { SchiedsrichterEditor } from "./SchiedsrichterEditor";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { SchiedsrichterRules } from "@/features/schiedsrichter/fieldRules";
import type { EditorSave } from "@/kit/useEditor";
import type { SchiedsrichterValues } from "./schiedsrichterValues";

const ID = "64b0000000000000000000a1";
const HOLDER = "anna@example.com";

const passkey = vi.hoisted(() => ({ prompt: vi.fn() }));

vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({ signIn: { passkey: passkey.prompt } }),
  usePreloadedAuthClient: () => undefined,
}));

/** What the save asks of the boxes, with patterns admitting anything: the case judges the server's refusal. */
const RULES: SchiedsrichterRules = {
  required: { name: true, email: true, phone: false, schule: false, default_payment: true },
  max: { name: 80, email: 254, schule: 120 },
  pattern: { name: ".*", phone: ".*" },
};

type Change = EditorSave<SchiedsrichterValues> & { holder: string };

type Save = (change: Change, dryRun?: boolean) => Promise<ActionAnswer<number>>;

/** The save marked as a lane declaring its dry run builds it: the mark is the type's alone, which only the builder gives. */
const declaringItsDryRun = (save: Save) => save as DryRunAction<Change, number>;

// The harm: a referee's save refused after the touch, a name another referee holds, which then has to be given again
// for the corrected name, where the save's dry run would have shown the refusal on the box first.
describe("the referee editor's save behind the passkey touch", () => {
  it("shows its dry run's refusal on the box asking no touch, and once it passes asks the touch, then saves", async () => {
    const order: string[] = [];
    const save = vi.fn<Save>(async (_change, dryRun) => {
      order.push(dryRun === true ? "dry run" : "save");
      // The first dry run finds the name taken; the next passes.
      return order.length === 1 ? { ok: false, fieldErrors: { "changes.name": COPY.shared.field.taken } } : { ok: true, value: 3 };
    });
    passkey.prompt.mockImplementationOnce(async () => {
      order.push("touch");
      return { data: { status: true, email: HOLDER }, error: null };
    });
    renderUnderNext(
      <SchiedsrichterEditor
        title={{ record: "Mia Muster" }}
        record={{
          id: ID,
          version: 2,
          values: { name: "Mia Muster", schule: "", email: "mia@example.org", phone: "", default_payment: "20" },
        }}
        save={declaringItsDryRun(save)}
        rules={RULES}
        address="asks"
        confirmation={[]}
        danger={{ kind: "retire", act: vi.fn<() => Promise<ActionAnswer>>() }}
        holder={HOLDER}
      />,
      { pathname: `/admin/schiedsrichter/${ID}`, params: { schiedsrichter: ID } },
    );
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: new RegExp(`^${COPY.shared.name}`) });
    const press = () => userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    await userEvent.clear(name);
    await userEvent.type(name, "Bo Lindqvist");
    await press();
    expect(await screen.findByText(COPY.shared.field.taken)).toBeTruthy();
    expect([order, name.value]).toStrictEqual([["dry run"], "Bo Lindqvist"]);

    await userEvent.clear(name);
    await userEvent.type(name, "Mia Kern");
    await press();
    await waitFor(() => expect(order).toStrictEqual(["dry run", "dry run", "touch", "save"]));
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ id: ID, version: 2, changes: { name: "Mia Kern" }, holder: HOLDER });
  });
});
