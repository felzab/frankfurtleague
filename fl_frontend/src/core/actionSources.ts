import { readFileSync } from "node:fs";
import path from "node:path";

import { blankComments } from "@/core/blankComments.ts";
import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** A listed file this reader cannot open fails the run: a population that drops it stays green for the file nobody read. */
function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(`${file} was listed by the walk and could not be read`, { cause });
  }
}

/**
 * Every `.ts` and `.tsx` under `src`, keyed by its path relative to `src`.
 *
 * Test files are IN: a slice's sweep is itself a test file, and a reader over the sweeps reads it as text.
 */
export const SOURCES: ReadonlyMap<string, string> = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    read(file),
  ]),
);

/** Each exported action's own source, ended at the next declaration of any kind, helpers included. */
export function actionBodies(text: string): Map<string, string> {
  const bare = blankComments(text);
  const declarations = [...bare.matchAll(/^(export )?(?:async )?function (\w+)/gm)];

  return new Map(
    declarations.flatMap((match, index): [string, string][] =>
      match[1] === undefined ? [] : [[match[2] ?? "", bare.slice(match.index, declarations[index + 1]?.index)]],
    ),
  );
}

/** The wrapper an admin action opens, which is what puts its own statements at four spaces. */
export function opensMutation(name: string): string {
  return `\n  return runAdminMutation("${name}", async () => {\n`;
}

/**
 * The module's value exports, counted by its own `export` lines rather than through `actionBodies`:
 * a second route to one number, required to agree (`docs/_standard/standard.md` PRE-4).
 */
function exportedValues(text: string): number {
  return [...blankComments(text).matchAll(/^export (?!type |interface )/gm)].length;
}

export interface ActionModule {
  /** Relative to `src`, forward slashes whatever the platform separates with. */
  readonly file: string;
  readonly bodies: ReadonlyMap<string, string>;
  readonly wrapped: number;
  readonly exported: number;
}

/** Every feature slice's server actions module, whether or not it is an admin one. */
export const ACTION_MODULES: readonly ActionModule[] = [...SOURCES]
  .filter(([file]) => /^features\/[^/]+\/actions\.ts$/.test(file))
  .map(([file, text]) => {
    const bodies = actionBodies(text);

    return {
      file,
      bodies,
      wrapped: [...bodies.values()].filter((body) => body.includes("runAdminMutation(")).length,
      exported: exportedValues(text),
    };
  });

/* Admin by the wrapper and never by the slice's name: `features/auth/actions.ts` exports server
   actions too, and runs them through `runWithIncomingTrace`, which owes no admin page anything. */
export const ADMIN_ACTION_MODULES: readonly ActionModule[] = ACTION_MODULES.filter((module) => module.wrapped > 0);
