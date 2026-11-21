import shareImage from "@/app/share-image.png";
import { SERVER_COPY } from "@/core/serverCopy";

/**
 * The image a shared link's preview shows, which the root layout and every page's own preview spread: a page declaring
 * `openGraph` replaces the parent's whole, image included. A static import, so its address under `/_next/static/media/`
 * carries a hash of the file's own bytes and a redrawn image is a new URL a preview fetches anew. A generated
 * `opengraph-image` route's hash is its source's, and the static file convention takes its alt from a `.txt` outside
 * the catalogue.
 */
export const SHARE_IMAGE = {
  images: [{ url: shareImage.src, width: shareImage.width, height: shareImage.height, alt: SERVER_COPY.shareImage.alt }],
};
