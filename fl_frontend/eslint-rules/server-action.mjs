/**
 * The one way to a server action and the few route handlers, read off syntax. A `"use server"` module exports
 * nothing but `const` calls of the builder imported from `@/core/action`; what each call declares is the builder's
 * type's to hold (`fl_frontend/src/core/action.ts :: action`): the admin lane, the person lane with its claim, and the
 * public lane behind the bot check or under one of the exemptions it names. A function-level `"use server"` is an
 * action no builder made, and a route handler stands only in the files the options keep. Whatever the rule cannot read
 * as one of these fails, so a new shape is refused rather than waved through.
 */

import path from "node:path";

const BUILDER = "@/core/action";
// Next routes `.ts` and `.tsx` files alone (`next.config.ts :: pageExtensions`), the two this rule's files reach.
const ROUTE = /(?:^|\/)src\/app\/(?:.*\/)?route\.tsx?$/;
/** `fl_frontend`, read off this file's place rather than the directory ESLint was started in. */
const ROOT = path.resolve(import.meta.dirname, "..");

/** @type {import("eslint").Rule.RuleModule} */
const serverAction = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { keptRoutes: { type: "array", items: { type: "string" } } },
        required: ["keptRoutes"],
        additionalProperties: false,
      },
    ],
    messages: {
      notBuilt: 'Every export of a "use server" module is `export const <name> = action(...)`, the builder from @/core/action.',
      inline: 'A function-level "use server" is an action no builder made: export it from a "use server" module, built by `action`.',
      route: "A route handler stands only in the kept files. A browser's form posts through a server action built by `action`.",
    },
  },

  create(context) {
    const [{ keptRoutes }] = context.options;
    // Relative to the project, as the options name the kept files.
    const filename = path.relative(ROOT, path.resolve(ROOT, context.filename)).replaceAll("\\", "/");
    let builder = null;

    /** Whether `node` calls the builder as imported here. */
    const isBuilt = (node) => node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === builder;

    return {
      Program(program) {
        if (ROUTE.test(filename) && !keptRoutes.includes(filename)) context.report({ node: program, messageId: "route" });

        // The parser marks the leading string statements alone as directives, so `"use strict"` ahead of
        // `"use server"` still makes an action module, as Next reads one.
        if (!program.body.some((statement) => statement.directive === "use server")) return;

        for (const statement of program.body) {
          if (statement.type === "ImportDeclaration" && statement.source.value === BUILDER) {
            const named = statement.specifiers.find(
              (specifier) => specifier.type === "ImportSpecifier" && specifier.imported.name === "action",
            );
            if (named !== undefined) builder = named.local.name;
          }
        }

        for (const statement of program.body) {
          if (statement.type === "ExportAllDeclaration" || statement.type === "ExportDefaultDeclaration") {
            context.report({ node: statement, messageId: "notBuilt" });
            continue;
          }
          if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;

          const { declaration } = statement;
          // A type is erased; a re-export or a function is an action the builder never saw.
          if (declaration?.type === "TSTypeAliasDeclaration" || declaration?.type === "TSInterfaceDeclaration") continue;
          if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
            context.report({ node: statement, messageId: "notBuilt" });
            continue;
          }
          for (const declarator of declaration.declarations) {
            if (declarator.id.type !== "Identifier" || !isBuilt(declarator.init)) context.report({ node: declarator, messageId: "notBuilt" });
          }
        }
      },

      // Every function body: a directive there makes the function an action of its own.
      ":function > BlockStatement > ExpressionStatement[directive='use server']"(node) {
        context.report({ node, messageId: "inline" });
      },
    };
  },
};

export default serverAction;
