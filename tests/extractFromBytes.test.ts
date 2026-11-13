// tests/extractFromBytes.test.ts
//
// Integration tests for byte-level extraction: the new extractFromBytes
// entry point, the URL entry point's unified byte pipeline, and equivalence
// between the byte and string entry points.

import { assertEquals, assertRejects } from "@std/assert";
import { extract, extractFromBytes, extractFromHtml } from "../src/main.ts";
import { createMockByteFetcher, readByteFixture } from "./helpers.ts";

const URL = "https://example.com/path/to/article";

Deno.test("extractFromBytes - Chinese GBK article via meta", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-zh-gbk.bin"),
    URL,
  );
  assertEquals(result?.title, "中文文章标题：编码检测测试");
  assertEquals(result?.url, URL);
  assertEquals(result?.content?.includes("人工智能"), true);
});

Deno.test("extractFromBytes - Japanese Shift_JIS via http-equiv", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-ja-sjis.bin"),
    URL,
  );
  assertEquals(result?.title, "日本語記事タイトル：文字コード判定テスト");
  assertEquals(result?.content?.includes("人工知能"), true);
});

Deno.test("extractFromBytes - Western windows-1252", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-es-1252.bin"),
    URL,
  );
  assertEquals(
    result?.title,
    "Título en español — ¿cómo está la codificación?",
  );
  assertEquals(result?.content?.includes("piñata"), true);
  assertEquals(result?.content?.includes("100 €"), true);
});

Deno.test("extractFromBytes - UTF-16LE and UTF-16BE BOM", async () => {
  const le = await extractFromBytes(
    readByteFixture("article-zh-utf16le.bin"),
    URL,
  );
  const be = await extractFromBytes(
    readByteFixture("article-zh-utf16be.bin"),
    URL,
  );
  assertEquals(le?.title, "中文文章标题：编码检测测试");
  assertEquals(be?.title, "中文文章标题：编码检测测试");
  assertEquals(le, be);
});

Deno.test("extractFromBytes - HTTP charset selects BOMless UTF-16LE", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-ja-utf16le-nobom.bin"),
    URL,
    "text/html; charset=utf-16le",
  );
  assertEquals(result?.title, "日本語記事タイトル：文字コード判定テスト");
});

Deno.test("extractFromBytes - conflict: HTTP gbk overrides meta utf-8", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-conflict-http-gbk.bin"),
    URL,
    "text/html; charset=gbk",
  );
  assertEquals(result?.title, "中文文章标题：编码检测测试");
});

Deno.test("extractFromBytes - conflict: BOM overrides HTTP gbk", async () => {
  const result = await extractFromBytes(
    readByteFixture("article-bom-over-http.bin"),
    URL,
    "text/html; charset=gbk",
  );
  assertEquals(result?.title, "Byte Decoding Equivalence Article");
});

Deno.test("extractFromBytes - empty bytes resolve to null", async () => {
  assertEquals(await extractFromBytes(new Uint8Array(0), URL), null);
  assertEquals(await extractFromBytes(new ArrayBuffer(0), URL), null);
});

Deno.test("extractFromBytes - whitespace-only bytes resolve to null", async () => {
  const bytes = new TextEncoder().encode("  \n\t  \r\n ");
  assertEquals(await extractFromBytes(bytes, URL), null);
});

Deno.test("extract - URL pipeline decodes GBK via Content-Type header", async () => {
  const fetcher = createMockByteFetcher(
    readByteFixture("article-conflict-http-gbk.bin"),
    "text/html; charset=gbk",
  );
  const result = await extract(URL, {}, fetcher);
  assertEquals(result?.title, "中文文章标题：编码检测测试");
});

Deno.test("extract - URL pipeline handles UTF-8 BOM response", async () => {
  const fetcher = createMockByteFetcher(
    readByteFixture("article-bom-over-http.bin"),
    "text/html; charset=gbk",
  );
  const result = await extract(URL, {}, fetcher);
  assertEquals(result?.title, "Byte Decoding Equivalence Article");
});

Deno.test("extract - custom fetcher is preserved and receives the URL", async () => {
  const bytes = readByteFixture("article-zh-gbk.bin");
  const inner = createMockByteFetcher(bytes, "text/html");
  const myFetcher = (fetchUrl: string) => {
    assertEquals(fetchUrl, URL);
    return inner();
  };
  const result = await extract(URL, {}, myFetcher);
  assertEquals(result?.title, "中文文章标题：编码检测测试");
});

Deno.test("extract - HTTP error semantics are unchanged", async () => {
  const fetcher = createMockByteFetcher(
    new TextEncoder().encode("Error 500"),
    "text/plain",
    500,
  );
  await assertRejects(
    () => extract(URL, {}, fetcher),
    Error,
    "Request failed with error code 500",
  );
});

Deno.test("extract - empty response body still resolves to null", async () => {
  const fetcher = createMockByteFetcher(new Uint8Array(0), "text/html");
  assertEquals(await extract(URL, {}, fetcher), null);
});

Deno.test("entry points - bytes and HTML string return identical data", async () => {
  const bytes = readByteFixture("article-en-utf8-nobom.bin");
  const html = new TextDecoder().decode(bytes);

  const fromBytes = await extractFromBytes(bytes, URL);
  const fromHtml = await extractFromHtml(html, URL);

  assertEquals(fromBytes, fromHtml);
  // The string entry never re-decodes: it receives the already decoded HTML
  // as-is and produces the very same structure as the byte entry.
});

Deno.test("entry points - GBK bytes equal the correctly decoded string", async () => {
  const bytes = readByteFixture("article-zh-gbk.bin");
  const html = new TextDecoder("gbk").decode(bytes);

  const fromBytes = await extractFromBytes(bytes, URL);
  const fromHtml = await extractFromHtml(html, URL);

  assertEquals(fromBytes, fromHtml);
  assertEquals(fromBytes?.title, "中文文章标题：编码检测测试");
});

Deno.test("entry points - options affect both pipelines identically", async () => {
  const bytes = readByteFixture("article-en-utf8-nobom.bin");
  const html = new TextDecoder().decode(bytes);
  const options = { wordsPerMinute: 120, descriptionTruncateLen: 80 };

  const fromBytes = await extractFromBytes(bytes, URL, null, options);
  const fromHtml = await extractFromHtml(html, URL, options);

  assertEquals(fromBytes, fromHtml);
});
