// utils -> charset.ts
//
// Unified HTML byte decoding.
//
// Encoding resolution order:
//   1. UTF-8 / UTF-16 BOM
//   2. valid HTTP charset (from the final response's Content-Type)
//   3. first valid <meta> charset declaration inside the first 1024 bytes
//   4. UTF-8
//
// The detection works directly on raw bytes. The document MUST NOT be parsed
// as a DOM (which would first decode it as UTF-8) before choosing the
// encoding.

/** Number of leading bytes scanned for a <meta> charset declaration. */
export const META_PRESCAN_LIMIT = 1024;

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16_LE = [0xff, 0xfe];
const BOM_UTF16_BE = [0xfe, 0xff];

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  bytes.length >= signature.length &&
  signature.every((b, i) => bytes[i] === b);

/** Find the index of an ASCII needle inside bytes, starting at `from`. */
const indexOfAscii = (
  bytes: Uint8Array,
  needle: string,
  from: number,
): number => {
  const first = needle.charCodeAt(0);
  outer:
  for (let i = from; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) {
      continue;
    }
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
};

/**
 * Check whether `label` names an encoding supported by TextDecoder.
 * Empty labels and unknown encodings are rejected.
 */
export const isSupportedCharset = (label: string): boolean => {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  try {
    new TextDecoder(normalized);
    return true;
  } catch {
    return false;
  }
};

/**
 * Extract a valid charset parameter from an HTTP Content-Type header value,
 * e.g. `text/html; charset=GBK`. Returns null when absent or unsupported.
 */
export const getCharsetFromContentType = (
  contentType: string | null | undefined,
): string | null => {
  if (!contentType) {
    return null;
  }
  const match = /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]+))/i.exec(
    contentType,
  );
  if (!match) {
    return null;
  }
  const label = (match[1] ?? match[2] ?? match[3] ?? "").trim().toLowerCase();
  return isSupportedCharset(label) ? label : null;
};

const isWhitespace = (b: number): boolean =>
  b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;

const isTagTerminator = (b: number): boolean => b === 0x3e; // >

const isNameByte = (b: number): boolean =>
  !isWhitespace(b) && b !== 0x3d && b !== 0x2f && b !== 0x3e;

const toAsciiLower = (b: number): number =>
  b >= 0x41 && b <= 0x5a ? b + 0x20 : b;

const isMetaKeyword = (value: string, keyword: string): boolean => {
  // ASCII case-insensitive comparison; non-ASCII bytes never match.
  if (value.length !== keyword.length) {
    return false;
  }
  for (let i = 0; i < keyword.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) {
      return false;
    }
    const lower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (lower !== keyword.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};

type ParsedTag = {
  name: string;
  attrs: Map<string, string>;
  /** Byte index immediately after the tag's closing `>`. */
  end: number;
};

/**
 * Parse the tag opening that starts at `start` (the byte index of `<`).
 * Returns null when the tag does not terminate with `>` before the prescan
 * limit, or when it is a closing tag, comment or declaration.
 */
const parseTag = (
  bytes: Uint8Array,
  start: number,
  limit: number,
): ParsedTag | null => {
  let i = start + 1;
  if (i >= limit) {
    return null;
  }

  // Closing tags, comments, doctype and other declarations carry no charset.
  if (
    bytes[i] === 0x2f || // /
    bytes[i] === 0x21 || // !
    bytes[i] === 0x3f // ?
  ) {
    return null;
  }

  const nameBytes: number[] = [];
  while (i < limit && isNameByte(bytes[i])) {
    nameBytes.push(toAsciiLower(bytes[i]));
    i++;
  }

  const attrs = new Map<string, string>();

  while (i < limit) {
    // Skip whitespace and solidi between attributes.
    while (i < limit && (isWhitespace(bytes[i]) || bytes[i] === 0x2f)) {
      i++;
    }
    if (i >= limit) {
      break;
    }
    if (isTagTerminator(bytes[i])) {
      i++;
      return {
        name: String.fromCharCode(...nameBytes),
        attrs,
        end: i,
      };
    }

    // Attribute name.
    const attrName: number[] = [];
    while (i < limit && isNameByte(bytes[i])) {
      attrName.push(toAsciiLower(bytes[i]));
      i++;
    }

    // Skip whitespace before a possible "=".
    while (i < limit && isWhitespace(bytes[i])) {
      i++;
    }

    let attrValue = "";
    if (i < limit && bytes[i] === 0x3d) {
      i++;
      while (i < limit && isWhitespace(bytes[i])) {
        i++;
      }
      if (i < limit && (bytes[i] === 0x22 || bytes[i] === 0x27)) {
        const quote = bytes[i];
        i++;
        const value: number[] = [];
        while (i < limit && bytes[i] !== quote) {
          value.push(bytes[i]);
          i++;
        }
        if (i < limit) {
          i++; // consume closing quote
        }
        attrValue = String.fromCharCode(...value);
      } else {
        const value: number[] = [];
        while (i < limit && !isWhitespace(bytes[i]) && bytes[i] !== 0x3e) {
          value.push(bytes[i]);
          i++;
        }
        attrValue = String.fromCharCode(...value);
      }
    }

    if (attrName.length > 0) {
      const name = String.fromCharCode(...attrName);
      if (!attrs.has(name)) {
        attrs.set(name, attrValue);
      }
    }
  }

  // Unterminated tag: it cannot carry an applicable declaration.
  return null;
};

/**
 * Extract a charset label from a parsed <meta> tag. Supports both the
 * `<meta charset="...">` form and the
 * `<meta http-equiv="content-type" content="text/html; charset=...">` form.
 */
const charsetFromMeta = (tag: ParsedTag): string | null => {
  const charsetAttr = tag.attrs.get("charset");
  if (charsetAttr !== undefined) {
    const label = charsetAttr.trim().toLowerCase();
    return isSupportedCharset(label) ? label : null;
  }

  const httpEquiv = tag.attrs.get("http-equiv");
  const content = tag.attrs.get("content");
  if (
    httpEquiv !== undefined &&
    content !== undefined &&
    isMetaKeyword(httpEquiv, "content-type")
  ) {
    return getCharsetFromContentType(content);
  }

  return null;
};

/**
 * Prescan the first 1024 bytes for the first valid <meta> charset
 * declaration. Declarations hidden inside comments and <script> elements are
 * ignored, and tags starting at/after the limit do not participate.
 */
export const detectMetaCharset = (bytes: Uint8Array): string | null => {
  const limit = Math.min(META_PRESCAN_LIMIT, bytes.length);
  let i = 0;

  while (i < limit) {
    if (bytes[i] !== 0x3c) {
      i++;
      continue;
    }

    // Comment: <!-- ... -->
    if (
      bytes[i + 1] === 0x21 &&
      bytes[i + 2] === 0x2d &&
      bytes[i + 3] === 0x2d
    ) {
      const end = bytes.indexOf(0x3e, i + 4);
      i = end === -1 || end >= limit ? limit : end + 1;
      continue;
    }

    const tag = parseTag(bytes, i, limit);
    if (!tag) {
      i++;
      continue;
    }

    if (tag.name === "script") {
      // Skip the whole script element, including any pseudo-declaration in it.
      const close = indexOfAscii(bytes, "</script", i);
      if (close === -1 || close >= limit) {
        // An unclosed script element swallows the rest of the prescan window.
        return null;
      }
      i = close;
      continue;
    }

    if (tag.name === "meta") {
      const charset = charsetFromMeta(tag);
      if (charset) {
        return charset;
      }
    }

    // Unknown tags and meta tags without a valid charset are simply skipped.
    i = tag.end;
  }

  return null;
};

type DetectedEncoding = {
  label: string;
  bomLength: number;
};

/**
 * Resolve the encoding of raw HTML bytes following the documented priority:
 * BOM, HTTP charset, <meta> charset, then UTF-8.
 */
export const detectEncoding = (
  bytes: Uint8Array,
  contentType?: string | null,
): DetectedEncoding => {
  if (startsWith(bytes, BOM_UTF8)) {
    return { label: "utf-8", bomLength: BOM_UTF8.length };
  }
  if (startsWith(bytes, BOM_UTF16_LE)) {
    return { label: "utf-16le", bomLength: BOM_UTF16_LE.length };
  }
  if (startsWith(bytes, BOM_UTF16_BE)) {
    return { label: "utf-16be", bomLength: BOM_UTF16_BE.length };
  }

  const httpCharset = getCharsetFromContentType(contentType);
  if (httpCharset) {
    return { label: httpCharset, bomLength: 0 };
  }

  const metaCharset = detectMetaCharset(bytes);
  if (metaCharset) {
    return { label: metaCharset, bomLength: 0 };
  }

  return { label: "utf-8", bomLength: 0 };
};

/**
 * Decode raw HTML bytes into a string using the resolved encoding.
 *
 * - The BOM is always removed from the output.
 * - Invalid byte sequences are replaced with the Unicode replacement
 *   character (U+FFFD) instead of throwing.
 * - The bytes are decoded exactly once with the resolved encoding; the DOM
 *   is never built before the encoding is known.
 */
export const decodeHtmlBytes = (
  input: Uint8Array | ArrayBuffer,
  contentType?: string | null,
): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { label, bomLength } = detectEncoding(bytes, contentType);
  const decoder = new TextDecoder(label);
  return decoder.decode(bomLength ? bytes.subarray(bomLength) : bytes);
};
