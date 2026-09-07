import { writeFileSync } from "node:fs";

const [destination] = process.argv.slice(2);

if (destination === undefined) {
  process.stderr.write("usage: emit-environment-names.mjs <destination>\n");
  process.exit(2);
}

// Set before the schema loads, which a static import would not allow: `createEnv` validates while
// it is imported, and this reads the declared names on a machine holding no value for any of them.
process.env.SKIP_ENV_VALIDATION = "true";

// A server module, so this needs `--conditions=react-server`; without it `server-only` resolves to
// the module that throws. `package.json :: scripts` carries that flag and the alias hook.
const { DECLARED_ENVIRONMENT_NAMES } = await import("./src/core/config.ts");

writeFileSync(destination, `${JSON.stringify(DECLARED_ENVIRONMENT_NAMES, null, 2)}\n`);
