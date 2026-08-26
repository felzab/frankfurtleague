import { card } from "./card";

/**
 * What an admin CRUD list draws in place of its rows below `md`, where the list is a stack of cards
 * rather than a table. The message is the resource's; the box is shared so the lists cannot drift.
 */
export function AdminCrudEmptyCard({ message }: { message: string }) {
  return (
    <div className={`${card()} w-full`}>
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="muted-hint">{message}</p>
      </div>
    </div>
  );
}

/**
 * The same message inside the table above `md`. **One row tall, and it has to build that height
 * itself**: react-aria writes the empty `<td>` with no class at all, so neither the cell's inset nor
 * `ROW_ACTION_SIZE` — what makes a real row 72px — reaches it.
 */
export function AdminCrudEmptyRow({ message }: { message: string }) {
  return (
    <div className="px-6 py-4">
      <div className="flex min-h-10 items-center justify-center text-center">
        <p className="muted-hint">{message}</p>
      </div>
    </div>
  );
}
