import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SERVER_COPY } from "@/core/serverCopy";

// Generated rather than a static `opengraph-image.png`, whose alt Next reads from a `.txt` beside it alone: the
// generated route takes its alt as an export, so the catalogue words it. It serves the drawn image's own bytes.

export const alt = SERVER_COPY.shareImage.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Read once at module scope, as Next's example for a local asset does: the image depends on no request.
const image = await readFile(join(process.cwd(), "src/app/share-image.png"));

export default function OpengraphImage() {
  return new Response(new Uint8Array(image), { headers: { "Content-Type": contentType } });
}
