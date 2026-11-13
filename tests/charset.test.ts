// tests/charset.test.ts

import { assertEquals, assertThrows } from "@std/assert";
import {
  getCharsetFromContentType,
  getCharsetFromMeta,
  META_PRESCAN_SIZE,
  resolveCharset,
} from "../src/utils/charset.ts";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

Deno.test("getCharsetFromContentType - parses common forms", () => {
  assertEquals(
    getCharsetFromContentType("text/html; charset=gbk"),
    "gbk",
  );
  assertEquals(
    getCharsetFromContentType('text/html; charset="UTF-8"'),
    "UTF-8",
  );
  assertEquals(
    getCharsetFromContentType("text/html;Charset=GB2312"),
    "GB2312",
  );
  assertEquals(getCharsetFromContentType("text/html"), "");
  assertEquals(getCharsetFromContentType(null), "");
});

Deno.test("getCharsetFromMeta - meta charset, http-equiv and xml declaration", () => {
  assertEquals(
    getCharsetFromMeta(bytes('<meta charset="gbk">')),
    "gbk",
  );
  assertEquals(
    getCharsetFromMeta(
      bytes(
        "<meta http-equiv='Content-Type' content='text/html; charset=gb18030'>",
      ),
    ),
    "gb18030",
  );
  assertEquals(
    getCharsetFromMeta(
      bytes('<?xml version="1.0" encoding="gb2312"?><html></html>'),
    ),
    "gb2312",
  );
  // unquoted attribute
  assertEquals(
    getCharsetFromMeta(bytes("<meta charset=gbk>")),
    "gbk",
  );
  // unclosed (truncated) declaration is still recognized
  assertEquals(
    getCharsetFromMeta(bytes("<html><meta charset=gbk")),
    "gbk",
  );
  assertEquals(getCharsetFromMeta(bytes("<html><head></head></html>")), "");
});

Deno.test("getCharsetFromMeta - only inspects the first 1024 bytes", () => {
  const padding = " ".repeat(META_PRESCAN_SIZE);
  const late = padding + '<meta charset="gbk">';
  assertEquals(getCharsetFromMeta(bytes(late)), "");

  const early = '<meta charset="gbk">' +
    " ".repeat(META_PRESCAN_SIZE) + "<p>x</p>";
  assertEquals(getCharsetFromMeta(bytes(early)), "gbk");
});

Deno.test("resolveCharset - BOM wins over HTTP header and meta", () => {
  const body = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...bytes('<meta charset="gbk">rest'),
  ]);
  const decision = resolveCharset({
    bytes: body,
    contentType: "text/html; charset=gb18030",
  });
  assertEquals(decision.label, "utf-8");
  assertEquals(decision.source, "bom");
});

Deno.test("resolveCharset - HTTP charset beats meta and uses aliases", () => {
  const decision = resolveCharset({
    bytes: bytes('<meta charset="utf-8">'),
    contentType: "text/html; charset=gb2312",
  });
  assertEquals(decision.label, "gbk"); // gb2312 normalizes to gbk
  assertEquals(decision.source, "http");
});

Deno.test("resolveCharset - meta used when header has no charset", () => {
  const decision = resolveCharset({
    bytes: bytes(
      '<meta http-equiv="content-type" content="text/html; charset=gb18030">',
    ),
    contentType: "text/html",
  });
  assertEquals(decision.label, "gb18030");
  assertEquals(decision.source, "meta");
});

Deno.test("resolveCharset - falls back to utf-8", () => {
  const decision = resolveCharset({
    bytes: bytes("<html>plain</html>"),
    contentType: "text/html",
  });
  assertEquals(decision.label, "utf-8");
  assertEquals(decision.source, "default");
});

Deno.test("resolveCharset - unknown explicit declarations throw clearly", () => {
  assertThrows(
    () =>
      resolveCharset({
        bytes: bytes("<html/>"),
        contentType: "text/html; charset=x-klingon",
      }),
    Error,
    'Unsupported charset declaration: "x-klingon"',
  );
  assertThrows(
    () =>
      resolveCharset({
        bytes: bytes('<meta charset="totally-made-up">'),
        contentType: "text/html",
      }),
    Error,
    'Unsupported charset declaration: "totally-made-up"',
  );
});

Deno.test("resolveCharset - utf-16 BOM variants", () => {
  const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
  assertEquals(resolveCharset({ bytes: le }).label, "utf-16le");
  const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41]);
  assertEquals(resolveCharset({ bytes: be }).label, "utf-16be");
});
