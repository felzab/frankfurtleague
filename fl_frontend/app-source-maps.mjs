import { setSourceMapsSupport } from "node:module";

// Not `--enable-source-maps`, which maps `node_modules` too: that half cost the rendering test files
// about 7 percent of their CPU on the sixteen-core Windows machine (measured 2026-09-22), while a
// transpiled `.tsx` still names its own lines.
setSourceMapsSupport(true, { nodeModules: false, generatedCode: true });
