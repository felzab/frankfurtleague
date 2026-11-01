import { assert } from "vitest";

/**
 * Test-only, and `no-restricted-imports` in `fl_frontend/eslint.config.mjs` is what holds it there:
 * every export below replaces `process.stdout.write` for the length of a call.
 */

/** A run's stdout: the chunks that opened like documents verbatim, and those chunks parsed. */
type WrittenLines = { raw: string[]; documents: Record<string, unknown>[] };

function beginCapture(): { written: WrittenLines; restore: () => void } {
  const written: WrittenLines = { raw: [], documents: [] };
  const original = process.stdout.write;

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = String(chunk);
    // The runner's own reporter shares this stream, so a chunk that is not a document goes on to it
    // rather than being swallowed here.
    if (!text.startsWith("{")) return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    written.raw.push(text);
    // Here rather than in each suite: a writer that emitted two documents in one chunk would
    // otherwise be read as one by every caller.
    assert.ok(text.endsWith("\n") && !text.slice(0, -1).includes("\n"), `one document per line, got ${text}`);
    written.documents.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }) as typeof process.stdout.write;

  return {
    written: written,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

/** The awaited twin, for a route handler or a backend call that writes its line asynchronously. */
export async function documentsWrittenByAsync(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const { written, restore } = beginCapture();
  try {
    await run();
  } finally {
    restore();
  }

  return written.documents;
}
