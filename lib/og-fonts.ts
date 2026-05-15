/**
 * Shared font loader for @vercel/og image generation.
 * Fonts are bundled in public/fonts and lazy-loaded on first request.
 *
 * Why a shared module: each OG route (restaurant, leaderboard, digest)
 * needs the same Fraunces files. One cache, fewer disk reads.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFonts = {
  regular: ArrayBuffer;
  black: ArrayBuffer;
  italic: ArrayBuffer;
};

let fontsPromise: Promise<OgFonts> | null = null;

export async function loadOgFonts(): Promise<OgFonts> {
  if (!fontsPromise) {
    const fontDir = join(process.cwd(), "public", "fonts");
    fontsPromise = Promise.all([
      readFile(join(fontDir, "Fraunces-Regular.ttf")),
      readFile(join(fontDir, "Fraunces-Black.ttf")),
      readFile(join(fontDir, "Fraunces-Italic.ttf")),
    ]).then(([regular, black, italic]) => ({
      regular: regular.buffer.slice(
        regular.byteOffset,
        regular.byteOffset + regular.byteLength
      ) as ArrayBuffer,
      black: black.buffer.slice(
        black.byteOffset,
        black.byteOffset + black.byteLength
      ) as ArrayBuffer,
      italic: italic.buffer.slice(
        italic.byteOffset,
        italic.byteOffset + italic.byteLength
      ) as ArrayBuffer,
    }));
  }
  return fontsPromise;
}

/**
 * Convenience: returns the font descriptor array for ImageResponse.
 */
export async function ogFontDescriptors() {
  const fonts = await loadOgFonts();
  return [
    { name: "Fraunces", data: fonts.regular, weight: 400 as const, style: "normal" as const },
    { name: "Fraunces", data: fonts.black, weight: 900 as const, style: "normal" as const },
    { name: "Fraunces", data: fonts.italic, weight: 400 as const, style: "italic" as const },
  ];
}