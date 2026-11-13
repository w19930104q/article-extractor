// utils -> charset.ts
//
// Character encoding determination based on the actual HTTP response.
//
// Resolution order (highest priority first):
//   1. Byte order mark (BOM) at the very beginning of the body
//   2. `charset` parameter of the HTTP `Content-Type` header
//   3. Charset declaration found inside the first 1024 bytes of the body
//      (meta charset / meta http-equiv / XML declaration, common aliases)
//   4. UTF-8 fallback
//
// An explicit but unknown/unsupported declaration raises a clear error
// instead of silently falling back to UTF-8.

export type CharsetSource = "bom" | "http" | "meta" | "default";

export interface CharsetDecision {
  /** Normalized, TextDecoder-compatible encoding label. */
  label: string;
  /** Where the decision came from. */
  source: CharsetSource;
}

/** Number of leading bytes inspected for in-document charset declarations. */
export const META_PRESCAN_SIZE = 1024;

interface BomMatch {
  label: string;
  length: number;
}

/** BOM sequences mapped to their encoding labels. */
const detectBom = (bytes: Uint8Array): BomMatch | null => {
  if (
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return { label: "utf-8", length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { label: "utf-16le", length: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { label: "utf-16be", length: 2 };
  }
  return null;
};

const stripQuotes = (value: string): string =>
  value.trim().replace(/^["']|["']$/g, "").trim();

/**
 * Extract and validate the charset parameter of an HTTP
 * `Content-Type` header value, e.g. `text/html; charset=GBK`.
 */
export const getCharsetFromContentType = (
  contentType: string | null,
): string => {
  if (!contentType) return "";
  for (const part of contentType.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (key === "charset") {
      return stripQuotes(part.slice(eq + 1));
    }
  }
  return "";
};

const parseAttrs = (tagText: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagText)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs[name] = value;
  }
  return attrs;
};

/**
 * Prescan the first 1024 bytes for an in-document charset declaration.
 * ASCII patterns survive latin1 decoding regardless of the real encoding,
 * which lets us locate declarations without decoding the whole payload.
 * Cross-chunk declarations are handled because callers pass the fully
 * accumulated (or progressively growing) buffer.
 */
export const getCharsetFromMeta = (bytes: Uint8Array): string => {
  const head = bytes.subarray(0, Math.min(bytes.length, META_PRESCAN_SIZE));
  const text = new TextDecoder("iso-8859-1").decode(head);

  // XML declaration: <?xml version="1.0" encoding="gb2312"?>
  const xml = text.match(/<\?xml[\s\S]*?\bencoding\s*=\s*["']([^"']+)["']/i);
  if (xml) return stripQuotes(xml[1]);

  // meta tags; tolerate an unclosed tag when the response is truncated
  // exactly inside the declaration.
  const tags = text.match(/<meta\b[^>]*(?:>|$)/gi);
  if (!tags) return "";

  for (const tag of tags) {
    const attrs = parseAttrs(tag);

    if (attrs.charset) {
      return stripQuotes(attrs.charset);
    }

    const httpEquiv = (attrs["http-equiv"] || "").toLowerCase();
    if (httpEquiv === "content-type" && attrs.content) {
      const declared = getCharsetFromContentType(
        `text/html; ${attrs.content}`,
      );
      if (declared) return declared;
    }
  }

  return "";
};

/**
 * Validate an encoding label against the platform's TextDecoder registry
 * (which already understands common aliases such as gbk/gb2312 -> gb18030,
 * utf8 -> utf-8, latin1 -> windows-1252).
 */
const normalizeLabel = (raw: string): string => {
  const label = raw.trim().toLowerCase();
  if (!label) return "";
  try {
    return new TextDecoder(label).encoding;
  } catch {
    throw new Error(`Unsupported charset declaration: "${raw}"`);
  }
};

export interface ResolveCharsetOptions {
  /** Raw response body bytes accumulated so far. */
  bytes: Uint8Array;
  /** HTTP `Content-Type` header value, if any. */
  contentType?: string | null;
}

/**
 * Decide which encoding to use for decoding the response body.
 *
 * Priority: BOM -> HTTP charset -> meta declaration (first 1024 bytes)
 * -> UTF-8. Explicit unknown declarations throw.
 */
export const resolveCharset = (
  options: ResolveCharsetOptions,
): CharsetDecision => {
  const { bytes, contentType = null } = options;

  // 1. BOM always wins.
  const bom = detectBom(bytes);
  if (bom) {
    return { label: normalizeLabel(bom.label), source: "bom" };
  }

  // 2. HTTP Content-Type charset.
  const httpLabel = getCharsetFromContentType(contentType);
  if (httpLabel) {
    return { label: normalizeLabel(httpLabel), source: "http" };
  }

  // 3. In-document declaration within the first 1024 bytes.
  const metaLabel = getCharsetFromMeta(bytes);
  if (metaLabel) {
    return { label: normalizeLabel(metaLabel), source: "meta" };
  }

  // 4. Default.
  return { label: "utf-8", source: "default" };
};
