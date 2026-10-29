/**
 * The one way to a server action and the few route handlers, read off syntax. A `"use server"` module exports
 * nothing but `action({...})` calls of the builder (`fl_frontend/src/core/action.ts`), each naming its lane by a
 * literal: the admin lane, whose guard the builder runs; the person lane with its claim, a seat or a record; or the
 * public lane, behind the bot check or under an exemption that says why. A function-level `"use server"` is an
 * action no builder made, and a route handler stands only in the files the options keep. Whatever the rule cannot
 * read as one of these fails, so a new shape is refused rather than waved through.
 */

import path from "node:path";

const BUILDER = "@/core/action";
const LANES = new Set(["admin", "person", "public"]);
const CLAIMS = new Set(["seat", "record"]);
const ROUTE = /(?:^|\/)src\/app\/(?:.*\/)?route\.[jt]sx?$/;

const isDirective = (statement, value) => statement.type === "ExpressionStatement" && statement.directive === value;

/** The `key: value` of an object literal, or `undefined` where it has none or reads one it cannot see past. */
function property(object, key) {
  for (const entry of object.properties) {
    if (entry.type !== "Property" || entry.computed || entry.kind !== "init") continue;
    const name = entry.key.type === "Identifier" ? entry.key.name : entry.key.value;
    if (name === key) return entry.value;
  }
  return undefined;
}

const literal = (node) => (node?.type === "Literal" ? node.value : undefined);

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
      notBuilt: 'Every export of a "use server" module is `export const <name> = action({...})`, the builder from @/core/action.',
      lane: 'Name the action\'s lane with a literal: "admin", "person" or "public".',
      spread: "Spell the action's declaration out: the rule cannot read a spread or a computed key.",
      claim: 'A person\'s action names its claim with a literal: "seat" or "record".',
      botCheck: "A public action declares `botCheck: true`, or `exempt` with the reason a script choosing what it sends gains nothing.",
      inline: 'A function-level "use server" is an action no builder made: export it from a "use server" module, built by `action`.',
      route: "A route handler stands only in the kept files. A browser's form posts through a server action built by `action`.",
    },
  },

  create(context) {
    const [{ keptRoutes }] = context.options;
    // Relative to the project, as the options name the kept files.
    const filename = path.relative(context.cwd, path.resolve(context.cwd, context.filename)).replaceAll("\\", "/");
    let builder = null;

    /** Judges one `action({...})` declaration. */
    function judge(declaration) {
      const [spec, ...rest] = declaration.arguments;
      if (spec?.type !== "ObjectExpression" || rest.length > 0) return context.report({ node: declaration, messageId: "notBuilt" });
      if (spec.properties.some((entry) => entry.type !== "Property" || entry.computed))
        return context.report({ node: spec, messageId: "spread" });

      const lane = literal(property(spec, "lane"));
      if (!LANES.has(lane)) return context.report({ node: spec, messageId: "lane" });
      if (lane === "person" && !CLAIMS.has(literal(property(spec, "claim")))) return context.report({ node: spec, messageId: "claim" });
      if (lane === "public") {
        const botCheck = literal(property(spec, "botCheck"));
        const exempt = literal(property(spec, "exempt"));
        const declared = (botCheck === true) !== (typeof exempt === "string" && exempt.trim() !== "");
        if (!declared) context.report({ node: spec, messageId: "botCheck" });
      }
    }

    /** Whether `node` calls the builder as imported here. */
    const isBuilt = (node) => node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === builder;

    return {
      Program(program) {
        if (ROUTE.test(filename) && !keptRoutes.includes(filename)) context.report({ node: program, messageId: "route" });

        const first = program.body[0];
        if (first === undefined || !isDirective(first, "use server")) return;

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
            else judge(declarator.init);
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
