/**
 * The one way to a server action and the few route handlers, read off syntax. A `"use server"` module exports
 * nothing but `action({...})` calls of the builder (`fl_frontend/src/core/action.ts`), whose type holds each lane's
 * declaration: the admin lane, the person lane with its claim, and the public lane behind the bot check or under an
 * exemption. The rule reads what that type cannot: that an exemption says why, in a literal that is not blank, and
 * stands without the bot check. A function-level `"use server"` is an action no builder made, and a route handler
 * stands only in the files the options keep. Whatever the rule cannot read as one of these fails, so a new shape is
 * refused rather than waved through.
 */

import path from "node:path";

const BUILDER = "@/core/action";
// Next routes `.ts` and `.tsx` files alone (`next.config.ts :: pageExtensions`), the two this rule's files reach.
const ROUTE = /(?:^|\/)src\/app\/(?:.*\/)?route\.tsx?$/;

/**
 * What an object literal with no spread or computed key holds at `key`, or `undefined` where it has none. An accessor
 * or a method holds a function, which no check below reads as a literal.
 */
const property = (object, key) =>
  object.properties.find((entry) => (entry.key.type === "Identifier" ? entry.key.name : entry.key.value) === key)?.value;

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
      spread: "Spell the action's declaration out: the rule cannot read a spread or a computed key.",
      exempt:
        "A public action's `exempt` is a literal giving the reason a script choosing what it sends gains nothing, and stands without `botCheck`.",
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

      // The lane, a person's claim and a public action's bot check or exemption are the builder's type's to hold. It
      // takes any string as the reason, a blank one included, and an exemption beside `botCheck: true`.
      const exempt = property(spec, "exempt");
      if (exempt === undefined) return;
      const reason = exempt.type === "Literal" ? exempt.value : undefined;
      if (typeof reason !== "string" || reason.trim() === "" || property(spec, "botCheck") !== undefined)
        context.report({ node: spec, messageId: "exempt" });
    }

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
