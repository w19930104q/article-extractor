// tests/streaming.test.ts
//
// Offline tests for byte-stream handling: encoding resolution on chunked
// responses, BOM/header conflicts, GB18030, redirects, missing
// content-length, the response byte cap and resource release. Everything
// runs against in-memory ReadableStreams — no network access.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { extract } from "../src/main.ts";
import retrieve from "../src/utils/retrieve.ts";
import {
  chunkBytes,
  createChunkedStreamFetcher,
  createResponseWithUrl,
  encodeGb18030,
} from "./helpers.ts";

const inputUrl = "http://example.invalid/from/input";
const finalUrl = "https://final.example.invalid/path/to/article";

// Structured, multi-paragraph document with head links. It is long and
// varied enough to pass Readability's own thresholds regardless of the
// encoding used, and it carries relative links/images plus a canonical
// identity link.
const articleHtml = `<html><head>
<title>Streaming article title</title>
<link rel="canonical" href="https://identity.example.invalid/canonical/article">
<link rel="shortlink" href="https://sho.rt/abc">
</head>
<body>
<article>
<h1>Streaming article title</h1>
<p><a href="/dict/watermelon">watermelon</a> and <a href="page-two.html">page two</a>
Navigation here, few can name a rational peach that is not a conscientious goldfruit
wandering through the orchard on a bright and breezy summer morning.</p>
<p>Draped neatly on a hanger, the melons could be said to resemble knowledgeable
pigs that browse the library shelves for weathered books about distant harbors,
stormy seas and the patient sailors who charted them under open skies.</p>
<p><img src="./images/orange.png" alt="orange">
The quiet harbor master recorded every arriving vessel in a leather journal
that smelled of salt, tar and old ink, while gulls circled above the mastheads
and the tide crept steadily along the weathered stone quay before dawn.</p>
<p>Beyond the headland, fishing fleets followed the colder currents northward,
trading stories of lighthouses, fog banks and narrow escapes beneath the aurora
that shimmered green and silent over an otherwise perfectly black ocean.</p>
</article>
</body></html>`;

const utf8Bytes = new TextEncoder().encode(articleHtml);

Deno.test("stream - UTF-8 multibyte character split across chunks", async () => {
  // Split at awkward offsets so that multibyte sequences and tags straddle
  // chunk boundaries.
  const chunks = chunkBytes(utf8Bytes, [1, 4, 7, 13, 19, 31, 57, 99]);
  const fetcher = createChunkedStreamFetcher(chunks, {
    contentType: "text/html; charset=utf-8",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null, "article should be extracted from split chunks");
  assertEquals(result.title, "Streaming article title");
  assert(result.content!.includes("watermelon"));
});

Deno.test("stream - meta charset declaration split across chunks", async () => {
  const html = articleHtml.replace(
    "<head>",
    '<head><meta http-equiv="Content-Type" content="text/html; charset=gb18030">',
  );
  const bytes = encodeGb18030(html);
  // Put a chunk boundary right in the middle of the charset attribute so
  // the declaration itself straddles two chunks.
  const cut = html.indexOf("gb18030") + 3;
  const chunks = chunkBytes(bytes, [cut, cut + 5, cut + 20]);
  const fetcher = createChunkedStreamFetcher(chunks, {
    contentType: "text/html",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null, "split meta declaration must still be detected");
  assertEquals(result.title, "Streaming article title");
});

Deno.test("stream - BOM overrides conflicting HTTP charset", async () => {
  const withBom = new Uint8Array(utf8Bytes.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(utf8Bytes, 3);
  const chunks = chunkBytes(withBom, [2, 10, 64, 200]);
  const fetcher = createChunkedStreamFetcher(chunks, {
    // Header claims GB18030; BOM says UTF-8 and must win.
    contentType: "text/html; charset=gb18030",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null);
  assertEquals(result.title, "Streaming article title");
  assert(!result.content!.includes("�"));
});

Deno.test("stream - GB18030 body declared by HTTP header", async () => {
  const gbkHtml = `<html><head><title>中文标题 GB page</title>` +
    `<link rel="canonical" href="https://identity.example.invalid/gbk"></head>` +
    `<body><article><h1>中文标题 GB page</h1>` +
    `<p>中文 is the marker: knowledge pigs melons orchard weathered books ` +
    `distant harbors stormy seas starlight navigation every quiet evening here.</p>` +
    `<p>The harbor master recorded vessels in a leather journal while gulls ` +
    `circled the mastheads and the tide crept along the weathered stone quay.</p>` +
    `<p>Fishing fleets followed colder currents northward trading stories of ` +
    `lighthouses, fog banks and narrow escapes beneath the silent green aurora.</p>` +
    `</article></body></html>`;
  const bytes = encodeGb18030(gbkHtml);
  const chunks = chunkBytes(bytes, [3, 17, 40, 80]);
  const fetcher = createChunkedStreamFetcher(chunks, {
    contentType: "text/html; charset=gb18030",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null, "GB18030 article must decode and extract");
  assertEquals(result.title, "中文标题 GB page");
});

Deno.test("stream - GB18030 body declared by meta, unknown label errors", async () => {
  const bytes = encodeGb18030(
    articleHtml.replace("<head>", '<head><meta charset="gb18030">'),
  );
  const fetcher = createChunkedStreamFetcher([bytes], {
    contentType: "text/html",
  });
  const ok = await extract(inputUrl, {}, fetcher);
  assert(ok !== null);
  assertEquals(ok.title, "Streaming article title");

  const badBytes = new TextEncoder().encode(
    articleHtml.replace("<head>", '<head><meta charset="x-klingon">'),
  );
  const badFetcher = createChunkedStreamFetcher([badBytes], {
    contentType: "text/html",
  });
  await assertRejects(
    () => extract(inputUrl, {}, badFetcher),
    Error,
    'Unsupported charset declaration: "x-klingon"',
  );
});

Deno.test("stream - redirect: relative links resolve against final URL", async () => {
  const fetcher = createChunkedStreamFetcher([utf8Bytes], {
    contentType: "text/html",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null);
  // Root-relative anchor and document-relative image must both be based on
  // the final response URL, never the input URL or the canonical link.
  assert(
    result.content!.includes(
      "https://final.example.invalid/dict/watermelon",
    ),
    "relative anchor must resolve against final URL",
  );
  assert(
    result.content!.includes(
      "https://final.example.invalid/path/to/images/orange.png",
    ),
    "relative image must resolve against final URL",
  );
  assert(
    result.content!.includes(
      "https://final.example.invalid/path/to/page-two.html",
    ),
  );
  // Canonical still identifies the article, but never drives resolution.
  assert(
    result.links!.includes(
      "https://identity.example.invalid/canonical/article",
    ),
  );
});

Deno.test("stream - custom fetcher without final URL falls back to input URL", async () => {
  const fetcher = createChunkedStreamFetcher([utf8Bytes], {
    contentType: "text/html",
    // no finalUrl: Response.url stays ""
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null);
  // Root-relative path replaces the input URL's path per URL semantics.
  assert(
    result.content!.includes(
      "http://example.invalid/dict/watermelon",
    ),
    "without a final URL the input URL is the resolution base",
  );
  // A document-relative link keeps the input URL path.
  assert(
    result.content!.includes(
      "http://example.invalid/from/page-two.html",
    ),
  );
});

Deno.test("stream - relative <base href> is resolved from the final URL", async () => {
  const html = `<html><head>
<base href="/assets/">
<title>Base test article title</title>
<link rel="canonical" href="https://identity.example.invalid/c">
</head><body>
<article>
<h1>Base test article title</h1>
<p>The harbor master recorded every arriving vessel in a leather journal
that smelled of salt and old ink while the tide crept along the stone quay.</p>
<p><img src="img/x.png" alt="x"> Gulls circled above the mastheads while
patient sailors navigated stormy seas by nothing but clear starlight.</p>
<p>Draped neatly on a hanger, the melons resembled knowledgeable pigs
wandering through the orchard looking for ripe figs and warm sunshine.</p>
<p>The quiet library held rows of weathered books whispering stories of
distant harbors and the brave crews who charted them under open skies.</p>
<p>Navigation here, few can name a rational peach that is not a conscientious
goldfruit browsing the garden on bright and breezy summer mornings.</p>
</article></body></html>`;
  const bytes = new TextEncoder().encode(html);
  const fetcher = createChunkedStreamFetcher([bytes], {
    contentType: "text/html",
    finalUrl,
  });
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null, "document with relative base must still extract");
  assert(
    result.content!.includes(
      "https://final.example.invalid/assets/img/x.png",
    ),
    "relative base must first be resolved against the final URL",
  );
});

Deno.test("stream - missing content-length does not break extraction", async () => {
  // createChunkedStreamFetcher sets no content-length header.
  const fetcher = createChunkedStreamFetcher(
    chunkBytes(utf8Bytes, [11, 53, 127, 300]),
    { contentType: "text/html", finalUrl },
  );
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null);
  assertEquals(result.title, "Streaming article title");
});

Deno.test("stream - body exactly at the byte limit is accepted", async () => {
  const limit = utf8Bytes.length;
  const fetcher = createChunkedStreamFetcher(
    chunkBytes(utf8Bytes, [10, limit - 20]),
    { contentType: "text/html", finalUrl },
  );
  const result = await extract(
    inputUrl,
    { maxResponseBytes: limit },
    fetcher,
  );
  assert(result !== null, "a body equal to the cap must not be rejected");
  assertEquals(result.title, "Streaming article title");

  // retrieve-level boundary check as well.
  const direct = await retrieve(
    inputUrl,
    createChunkedStreamFetcher(chunkBytes(utf8Bytes, [5]), { finalUrl }),
    { maxResponseBytes: limit },
  );
  assertEquals(direct.bytes.length, limit);
});

Deno.test("stream - exceeding the limit mid-body cancels and returns no article", async () => {
  let cancelled = false;
  const limit = 100;
  const fetcher = createChunkedStreamFetcher(
    chunkBytes(utf8Bytes, [40, 40, 40, 40]),
    {
      contentType: "text/html",
      finalUrl,
      onCancel: () => cancelled = true,
    },
  );
  await assertRejects(
    () => extract(inputUrl, { maxResponseBytes: limit }, fetcher),
    Error,
    `Response body exceeds the limit of ${limit} bytes`,
  );
  assert(cancelled, "the underlying stream must have been cancelled");
});

Deno.test("stream - oversized chunk aborts and releases the body stream", async () => {
  // When a chunk itself crosses the cap, retrieval rejects on that read.
  // A body that keeps producing chunks must be torn down: assert the
  // cancel hook fires and the reader lock is released (the stream becomes
  // readable again), proving no connection is leaked and no partial
  // article can be assembled.
  let cancelled = false;
  let enqueued = 0;
  const fetcher = () => {
    const stream = new ReadableStream({
      pull(controller) {
        // Keep supplying data, like an unbounded server response.
        controller.enqueue(new Uint8Array(2048).fill(0x61));
        enqueued += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    return Promise.resolve(new Response(stream));
  };
  await assertRejects(
    () => retrieve(inputUrl, fetcher, { maxResponseBytes: 1024 }),
    Error,
    "exceeds the limit of 1024 bytes",
  );
  assert(cancelled, "an actively producing body must be cancelled");
  assert(
    enqueued <= 2,
    "production must stop almost immediately after the cap is hit",
  );
});

Deno.test("stream - default behavior imposes no byte cap", async () => {
  const fetcher = createChunkedStreamFetcher(
    chunkBytes(utf8Bytes, [64, 256, 1024, 4096]),
    { contentType: "text/html", finalUrl },
  );
  const result = await extract(inputUrl, {}, fetcher);
  assert(result !== null);
  assertEquals(result.title, "Streaming article title");
});

Deno.test("stream - plain Response (non-stream helper) still resolves final URL", () => {
  const res = createResponseWithUrl("x", finalUrl);
  assertEquals(res.url, finalUrl);
});
