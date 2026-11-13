// main.ts

import { retrieveResource } from "./utils/retrieve.ts";
import parseFromHtml from "./utils/parseFromHtml.ts";
import { decodeHtmlBytes } from "./utils/charset.ts";
import { isHTML } from "./utils/html.ts";
import { isValid as isValidUrl } from "./utils/linker.ts";

import type { ArticleData, Fetcher, ParserOptions } from "./types.ts";

/**
 * Load and extract article data from a URL or HTML string.
 *
 * For URL inputs the raw response bytes are decoded exactly once using the
 * unified encoding detection (BOM, HTTP charset, <meta> charset, UTF-8).
 * HTML string inputs are parsed as-is and are never re-decoded.
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

  if (inputType === "html") {
    return parseFromHtml(input, "", parserOptions);
  }

  const { buffer, contentType } = await retrieveResource(input, fetcher);
  const html = decodeHtmlBytes(buffer, contentType);
  if (!html.trim()) {
    return null;
  }
  return parseFromHtml(html, input, parserOptions);
};

/**
 * Extract article data from an HTML string directly.
 *
 * The string is parsed as-is; no encoding re-detection or re-decoding is
 * performed because a JavaScript string has no byte-level encoding.
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

/**
 * Decode raw HTML bytes and extract article data from them.
 *
 * Encoding resolution order: UTF-8/UTF-16 BOM, valid HTTP charset from
 * `contentType`, first valid <meta> charset inside the leading 1024 bytes,
 * then UTF-8. The bytes are decoded before any DOM parsing, the BOM is
 * removed and invalid byte sequences become replacement characters.
 *
 * @param bytes - Raw HTML bytes (Uint8Array or ArrayBuffer)
 * @param url - Source URL for resolving relative links
 * @param contentType - Content-Type header value of the final response
 * @param parserOptions - Options for parsing
 * @returns Extracted article data or null
 */
// deno-lint-ignore require-await
export const extractFromBytes = async (
  bytes: Uint8Array | ArrayBuffer,
  url = "",
  contentType?: string | null,
  parserOptions: ParserOptions = {},
): Promise<ArticleData | null> => {
  const html = decodeHtmlBytes(bytes, contentType);
  if (!html.trim()) {
    return null;
  }
  return parseFromHtml(html, url, parserOptions);
};

export {
  addTransformations,
  removeTransformations,
} from "./utils/transformation.ts";

export * from "./types.ts";
