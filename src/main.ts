// main.ts

import retrieve from "./utils/retrieve.ts";
import parseFromHtml from "./utils/parseFromHtml.ts";
import { isHTML } from "./utils/html.ts";
import { resolveCharset } from "./utils/charset.ts";
import { isValid as isValidUrl } from "./utils/linker.ts";

import type { ArticleData, Fetcher, ParserOptions } from "./types.ts";

/**
 * Load and extract article data from a URL or HTML string.
 *
 * When given a URL, the response body is streamed as raw bytes and decoded
 * using the encoding determined from the actual response (BOM, HTTP
 * charset, in-document meta declaration within the first 1024 bytes, then
 * UTF-8). Relative links and images are resolved against the final
 * response URL.
 *
 * @param input - URL or HTML string to extract from
 * @param parserOptions - Options for parsing
 * @param fetcher - Custom fetch function. Defaults to globalThis.fetch.
 * @returns Extracted article data or null
 */
export const extract = async (
  input: string,
  parserOptions: ParserOptions = {},
  fetcher: Fetcher = globalThis.fetch,
): Promise<ArticleData | null> => {
  const inputType = isValidUrl(input)
    ? "url"
    : isHTML(input)
    ? "html"
    : "other";

  if (inputType === "other") {
    throw new Error("Input must be a URL or raw HTML");
  }

  // Pure HTML entry: the caller already decoded the text. Do not
  // re-detect/re-decode, and keep the original cleaning/link behavior
  // (resources resolve against the best URL found in the document).
  if (inputType === "html") {
    return parseFromHtml(input, "", parserOptions, "");
  }

  const { maxResponseBytes } = parserOptions;
  const { bytes, finalUrl, contentType } = await retrieve(input, fetcher, {
    maxResponseBytes,
  });

  if (!bytes.length) {
    return null;
  }

  // Determine the encoding from the actual response — never decode the
  // whole payload as UTF-8 first.
  const { label } = resolveCharset({ bytes, contentType });
  const html = new TextDecoder(label).decode(bytes);
  if (!html.trim()) {
    return null;
  }

  // The final URL (post-redirect) is the resource resolution base. When a
  // custom fetcher does not expose a final URL, retrieve falls back to the
  // input URL. The canonical link still identifies the article inside
  // parseFromHtml but never changes this base.
  return parseFromHtml(html, input, parserOptions, finalUrl);
};

/**
 * Extract article data from an HTML string directly.
 *
 * @param html - Raw HTML content
 * @param url - Source URL for resolving relative links
 * @param parserOptions - Options for parsing
 * @returns Extracted article data or null
 */
// deno-lint-ignore require-await
export const extractFromHtml = async (
  html: string,
  url?: string,
  parserOptions: ParserOptions = {},
): Promise<ArticleData | null> => {
  return parseFromHtml(html, url || "", parserOptions);
};

export {
  addTransformations,
  removeTransformations,
} from "./utils/transformation.ts";

export * from "./types.ts";
