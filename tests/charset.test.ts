// tests/charset.test.ts
//
// Fixed-byte tests for the unified HTML byte decoder. All inputs are literal
// byte arrays (or committed .bin fixtures), so no encoding tooling is needed
// at test time.

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  decodeHtmlBytes,
  detectEncoding,
  detectMetaCharset,
  getCharsetFromContentType,
  isSupportedCharset,
  META_PRESCAN_LIMIT,
} from "../src/utils/charset.ts";
import { readByteFixture } from "./helpers.ts";

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const BOM_UTF8 = new Uint8Array([0xef, 0xbb, 0xbf]);
const BOM_UTF16_LE = new Uint8Array([0xff, 0xfe]);
const BOM_UTF16_BE = new Uint8Array([0xfe, 0xff]);

Deno.test("isSupportedCharset - accepts WHATWG labels, rejects junk", () => {
  assertEquals(isSupportedCharset("utf-8"), true);
  assertEquals(isSupportedCharset("UTF-8"), true);
  assertEquals(isSupportedCharset("gbk"), true);
  assertEquals(isSupportedCharset("GB2312"), true);
  assertEquals(isSupportedCharset("shift_jis"), true);
  assertEquals(isSupportedCharset("windows-1252"), true);
  assertEquals(isSupportedCharset("iso-8859-1"), true);
  assertEquals(isSupportedCharset("utf-16le"), true);
  assertEquals(isSupportedCharset("utf-16be"), true);
  assertEquals(isSupportedCharset(""), false);
  assertEquals(isSupportedCharset("   "), false);
  assertEquals(isSupportedCharset("totally-made-up"), false);
});

Deno.test("getCharsetFromContentType - parses header variants", () => {
  assertEquals(
    getCharsetFromContentType("text/html; charset=gbk"),
    "gbk",
  );
  assertEquals(
    getCharsetFromContentType("Text/HTML; Charset=Shift_JIS"),
    "shift_jis",
  );
  assertEquals(
    getCharsetFromContentType('text/html; charset="UTF-16LE"'),
    "utf-16le",
  );
  assertEquals(
    getCharsetFromContentType("text/html; charset='GBK'"),
    "gbk",
  );
  assertEquals(
    getCharsetFromContentType("text/html;charset = windows-1252"),
    "windows-1252",
  );
  assertEquals(getCharsetFromContentType("text/html"), null);
  assertEquals(getCharsetFromContentType(null), null);
  assertEquals(getCharsetFromContentType(undefined), null);
  assertEquals(
    getCharsetFromContentType("text/html; charset=bogus-encoding"),
    null,
  );
});

Deno.test("detectMetaCharset - meta charset forms, case, quotes, order", () => {
  assertEquals(
    detectMetaCharset(ascii('<meta charset="gbk">')),
    "gbk",
  );
  assertEquals(
    detectMetaCharset(ascii("<META CHARSET='Shift_JIS'>")),
    "shift_jis",
  );
  assertEquals(
    detectMetaCharset(ascii("<meta charset=windows-1252>")),
    "windows-1252",
  );
  assertEquals(
    detectMetaCharset(
      ascii('<meta data-x="1" charset="gbk" id="c">'),
    ),
    "gbk",
  );
  assertEquals(
    detectMetaCharset(
      ascii(
        '<meta http-equiv="Content-Type" content="text/html; charset=gbk">',
      ),
    ),
    "gbk",
  );
  assertEquals(
    detectMetaCharset(
      ascii(
        "<META HTTP-EQUIV='content-type' CONTENT='text/html; charset=SHIFT_JIS'>",
      ),
    ),
    "shift_jis",
  );
});

Deno.test("detectMetaCharset - first valid declaration wins", () => {
  const bytes = ascii(
    '<head><meta charset="shift_jis"><meta charset="gbk"></head>',
  );
  assertEquals(detectMetaCharset(bytes), "shift_jis");
});

Deno.test("detectMetaCharset - unsupported labels fall through to next", () => {
  assertEquals(
    detectMetaCharset(
      ascii('<meta charset="bogus"><meta charset="gbk">'),
    ),
    "gbk",
  );
  assertEquals(
    detectMetaCharset(
      ascii(
        '<meta http-equiv="refresh" content="5; url=/x"><meta charset="gbk">',
      ),
    ),
    "gbk",
  );
  assertEquals(detectMetaCharset(ascii('<meta charset="bogus">')), null);
});

Deno.test("detectMetaCharset - ignores comments and script bodies", () => {
  assertEquals(
    detectMetaCharset(
      ascii('<!-- <meta charset="gbk"> --><meta charset="shift_jis">'),
    ),
    "shift_jis",
  );
  assertEquals(
    detectMetaCharset(
      ascii(
        '<script>var x = "<meta charset=\'gbk\'>";</script><meta charset="shift_jis">',
      ),
    ),
    "shift_jis",
  );
  assertEquals(
    detectMetaCharset(
      ascii('<script>/* <meta charset="gbk"> */</script>'),
    ),
    null,
  );
  assertEquals(
    detectMetaCharset(
      ascii(
        "<script>var x = 1; // never closed within the prescan window" +
          "a".repeat(META_PRESCAN_LIMIT) +
          '<meta charset="gbk">',
      ),
    ),
    null,
  );
});

Deno.test("detectMetaCharset - unknown tags are skipped, not parsed as meta", () => {
  assertEquals(
    detectMetaCharset(
      ascii('<bogus charset="gbk"></bogus><meta charset="shift_jis">'),
    ),
    "shift_jis",
  );
  assertEquals(
    detectMetaCharset(
      ascii('<div data-charset="gbk"><meta charset="gbk"></div>'),
    ),
    "gbk",
  );
});

Deno.test("detectMetaCharset - only the first 1024 bytes participate", () => {
  const padding = ascii("a".repeat(META_PRESCAN_LIMIT - 30));
  const inside = concat(
    padding,
    ascii('<meta charset="gbk">'),
  );
  const atBoundary = concat(
    ascii("a".repeat(META_PRESCAN_LIMIT - 20)),
    ascii('<meta charset="gbk">'),
  );
  const outside = concat(
    ascii("a".repeat(META_PRESCAN_LIMIT)),
    ascii('<meta charset="gbk">'),
  );
  assertEquals(detectMetaCharset(inside), "gbk");
  assertEquals(detectMetaCharset(atBoundary), "gbk");
  assertEquals(detectMetaCharset(outside), null);
});

Deno.test("detectMetaCharset - unterminated tag at the limit is ignored", () => {
  const bytes = ascii("a".repeat(META_PRESCAN_LIMIT - 5) + "<meta");
  assertEquals(detectMetaCharset(bytes), null);
});

Deno.test("detectMetaCharset - tag starting inside but closing past limit is out", () => {
  // The '<' is at index 1019 but the closing '>' lands beyond byte 1024.
  const declaration = '<meta charset="gbk">';
  const bytes = ascii(
    "a".repeat(META_PRESCAN_LIMIT - 5) + declaration,
  );
  assertEquals(detectMetaCharset(bytes), null);
});

Deno.test("detectMetaCharset - '>' inside an attribute value does not end scan", () => {
  const bytes = ascii(
    '<meta http-equiv="content-type" content=\'text/html; charset=gbk>\'><meta charset="shift_jis">',
  );
  // The quoted '>' must not terminate the first meta; its "gbk>" label is
  // invalid anyway, so scanning continues to the next declaration.
  assertEquals(detectMetaCharset(bytes), "shift_jis");
});

Deno.test("detectEncoding - BOM priority over HTTP and meta", () => {
  const utf8Bom = concat(BOM_UTF8, ascii('<meta charset="gbk">'));
  assertEquals(detectEncoding(utf8Bom, "text/html; charset=gbk"), {
    label: "utf-8",
    bomLength: 3,
  });

  const leBom = concat(BOM_UTF16_LE, new Uint8Array([0x41, 0x00]));
  assertEquals(detectEncoding(leBom, "text/html; charset=gbk"), {
    label: "utf-16le",
    bomLength: 2,
  });

  const beBom = concat(BOM_UTF16_BE, new Uint8Array([0x00, 0x41]));
  assertEquals(detectEncoding(beBom), {
    label: "utf-16be",
    bomLength: 2,
  });
});

Deno.test("detectEncoding - HTTP charset beats meta", () => {
  const bytes = ascii('<meta charset="utf-8">');
  assertEquals(
    detectEncoding(bytes, "text/html; charset=gbk"),
    { label: "gbk", bomLength: 0 },
  );
});

Deno.test("detectEncoding - invalid HTTP charset falls back to meta then utf-8", () => {
  const withMeta = ascii('<meta charset="shift_jis">');
  assertEquals(
    detectEncoding(withMeta, "text/html; charset=bogus"),
    { label: "shift_jis", bomLength: 0 },
  );
  assertEquals(
    detectEncoding(ascii("<html></html>"), "text/html"),
    { label: "utf-8", bomLength: 0 },
  );
});

Deno.test("decodeHtmlBytes - strips BOM and never emits it", () => {
  const decoded = decodeHtmlBytes(concat(BOM_UTF8, ascii("abc")));
  assertEquals(decoded, "abc");
  assertStrictEquals(decoded.startsWith("﻿"), false);

  // "AB" in UTF-16LE and UTF-16BE with BOM.
  assertEquals(
    decodeHtmlBytes(concat(BOM_UTF16_LE, new Uint8Array([0x41, 0, 0x42, 0]))),
    "AB",
  );
  assertEquals(
    decodeHtmlBytes(concat(BOM_UTF16_BE, new Uint8Array([0, 0x41, 0, 0x42]))),
    "AB",
  );
});

Deno.test("decodeHtmlBytes - invalid bytes become replacement characters", () => {
  // 0xFF is never valid as a leading UTF-8 byte.
  assertEquals(decodeHtmlBytes(new Uint8Array([0x41, 0xff, 0x42])), "A�B");
});

Deno.test("decodeHtmlBytes - accepts ArrayBuffer and Uint8Array", () => {
  const u8 = ascii("<p>hello</p>");
  const buffer = new ArrayBuffer(u8.length);
  new Uint8Array(buffer).set(u8);
  assertEquals(decodeHtmlBytes(buffer), decodeHtmlBytes(u8));
});

Deno.test("decodeHtmlBytes - Chinese GBK article via meta declaration", () => {
  const html = decodeHtmlBytes(readByteFixture("article-zh-gbk.bin"));
  assertEquals(html.startsWith("<"), true);
  assertEquals(html.includes("中文文章标题"), true);
  assertEquals(html.includes("人工智能正在改变人们的生活方式"), true);
  assertStrictEquals(html.includes("�"), false);
});

Deno.test("decodeHtmlBytes - Japanese Shift_JIS via http-equiv declaration", () => {
  const html = decodeHtmlBytes(readByteFixture("article-ja-sjis.bin"));
  assertEquals(html.includes("日本語記事タイトル"), true);
  assertEquals(html.includes("文字コードの自動判定"), true);
  assertStrictEquals(html.includes("�"), false);
});

Deno.test("decodeHtmlBytes - Western windows-1252 punctuation", () => {
  const html = decodeHtmlBytes(readByteFixture("article-es-1252.bin"));
  assertEquals(html.includes("Título en español"), true);
  assertEquals(html.includes("¡qué alegría"), true);
  assertEquals(html.includes("100 €"), true);
});

Deno.test("decodeHtmlBytes - UTF-16LE/BE BOM fixtures", () => {
  const le = decodeHtmlBytes(readByteFixture("article-zh-utf16le.bin"));
  const be = decodeHtmlBytes(readByteFixture("article-zh-utf16be.bin"));
  assertEquals(le.includes("中文文章标题"), true);
  assertEquals(be.includes("中文文章标题"), true);
  assertStrictEquals(le.startsWith("﻿"), false);
  assertStrictEquals(be.startsWith("﻿"), false);
});

Deno.test("decodeHtmlBytes - BOMless UTF-16 selected by HTTP charset", () => {
  const bytes = readByteFixture("article-ja-utf16le-nobom.bin");
  const viaHttp = decodeHtmlBytes(bytes, "text/html; charset=utf-16le");
  assertEquals(viaHttp.includes("日本語記事タイトル"), true);
  // Without any hint the default is UTF-8, which cannot read these bytes.
  const viaDefault = decodeHtmlBytes(bytes);
  assertStrictEquals(viaDefault.includes("日本語記事タイトル"), false);
});

Deno.test("decodeHtmlBytes - conflict: HTTP gbk beats lying meta utf-8", () => {
  const bytes = readByteFixture("article-conflict-http-gbk.bin");
  const viaHttp = decodeHtmlBytes(bytes, "text/html; charset=gbk");
  assertEquals(viaHttp.includes("中文文章标题"), true);
  // Relying on the meta alone would decode GBK bytes as UTF-8 with mojibake.
  const viaMeta = decodeHtmlBytes(bytes);
  assertStrictEquals(viaMeta.includes("中文文章标题"), false);
});

Deno.test("decodeHtmlBytes - conflict: UTF-8 BOM beats HTTP gbk", () => {
  const bytes = readByteFixture("article-bom-over-http.bin");
  const html = decodeHtmlBytes(bytes, "text/html; charset=gbk");
  assertEquals(html.includes("Byte Decoding Equivalence Article"), true);
  assertStrictEquals(html.startsWith("﻿"), false);
});
