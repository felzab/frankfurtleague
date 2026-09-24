import { setSourceMapsSupport } from "node:module";

// Not `--enable-source-maps`, which maps `node_modules` too: that half costs a measured share of every
// test file's CPU (`.github/gate-wall-clock.tsv :: "source maps for the application's modules alone"`),
// while a transpiled `.tsx` still names its own lines.
setSourceMapsSupport(true, { nodeModules: false, generatedCode: true });
