// tests/retrieve.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import retrieve from "../src/utils/retrieve.ts";

const makeResponse = (
  body: BodyInit | null,
  contentType: string,
  status = 200,
  url = "",
  headers: Record<string, string> = {},
): Response => {
  const res = new Response(body, {
    status,
    headers: { "content-type": contentType, ...headers },
  });
  if (url) {
    Object.defineProperty(res, "url", { value: url });
  }
  return res;
};

Deno.test("retrieve - bad status code", async () => {
  const url = "https://some.where/bad/page";
  const fetcher = () =>
    Promise.resolve(makeResponse("Error 500", "text/plain", 500));
  await assertRejects(
    () => retrieve(url, fetcher),
    Error,
    "Request failed with error code 500",
  );
});

Deno.test("retrieve - good source", async () => {
  const url = "https://some.where/good/page";
  const fetcher = () =>
    Promise.resolve(makeResponse("<div>this is content</div>", "text/html"));
  const result = await retrieve(url, fetcher);
  const html = new TextDecoder().decode(result.bytes);
  assertEquals(html, "<div>this is content</div>");
  // No final URL exposed -> fall back to the input URL.
  assertEquals(result.finalUrl, url);
  assertEquals(result.contentType, "text/html");
});

Deno.test("retrieve - good source with \\r\\n", async () => {
  const url = "https://some.where/good/page";
  const fetcher = () =>
    Promise.resolve(
      makeResponse(
        "\n\r\r\n\n<div>this is content</div>\n\r\r\n\n",
        "text/html",
      ),
    );
  const result = await retrieve(url, fetcher);
  const html = new TextDecoder().decode(result.bytes).trim();
  assertEquals(html, "<div>this is content</div>");
});

Deno.test("retrieve - custom fetcher", async () => {
  const url = "https://some.where/good/source-with-fetcher";
  const myFetcher = (fetchUrl: string) => {
    assertEquals(fetchUrl, url);
    return Promise.resolve(
      makeResponse("<div>this is content</div>", "text/html"),
    );
  };
  const result = await retrieve(url, myFetcher);
  const html = new TextDecoder().decode(result.bytes);
  assertEquals(html, "<div>this is content</div>");
});

Deno.test("retrieve - final URL comes from the response after redirect", async () => {
  const input = "http://some.where/redirect";
  const final = "https://some.where/final/article";
  const fetcher = () =>
    Promise.resolve(makeResponse("x", "text/html", 200, final));
  const result = await retrieve(input, fetcher);
  assertEquals(result.finalUrl, final);
});

Deno.test("retrieve - null body returns empty bytes", async () => {
  const url = "https://some.where/no-body";
  const fetcher = () => Promise.resolve(makeResponse(null, "text/html", 204));
  const result = await retrieve(url, fetcher);
  assertEquals(result.bytes.length, 0);
  assertEquals(result.finalUrl, url);
});

Deno.test("retrieve - rejects invalid maxResponseBytes", async () => {
  const url = "https://some.where/page";
  const fetcher = () => Promise.resolve(makeResponse("abc", "text/html"));
  await assertRejects(
    () => retrieve(url, fetcher, { maxResponseBytes: -1 }),
    Error,
    "maxResponseBytes must be a non-negative integer",
  );
  await assertRejects(
    () => retrieve(url, fetcher, { maxResponseBytes: 1.5 }),
    Error,
    "maxResponseBytes must be a non-negative integer",
  );
});

Deno.test("retrieve - missing content-length still streams and counts", async () => {
  const url = "https://some.where/chunked";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello "));
      controller.enqueue(new TextEncoder().encode("world"));
      controller.close();
    },
  });
  const fetcher = () => Promise.resolve(new Response(stream));
  const result = await retrieve(url, fetcher);
  assertEquals(new TextDecoder().decode(result.bytes), "hello world");
  assertEquals(result.contentType, null);
});
