// tests/retrieve.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import retrieve from "../src/utils/retrieve.ts";
import { createMockFetcher } from "./helpers.ts";

Deno.test("retrieve - bad status code", async () => {
  const url = "https://some.where/bad/page";
  const fetcher = createMockFetcher("Error 500", "text/plain", 500);
  await assertRejects(
    () => retrieve(url, fetcher),
    Error,
    "Request failed with error code 500",
  );
});

Deno.test("retrieve - good source", async () => {
  const url = "https://some.where/good/page";
  const fetcher = createMockFetcher("<div>this is content</div>", "text/html");
  const { buffer, url: finalUrl } = await retrieve(url, fetcher);
  const html = new TextDecoder().decode(buffer);
  assertEquals(html, "<div>this is content</div>");
  assertEquals(finalUrl, url);
});

Deno.test("retrieve - good source with \\r\\n", async () => {
  const url = "https://some.where/good/page";
  const fetcher = createMockFetcher(
    "\n\r\r\n\n<div>this is content</div>\n\r\r\n\n",
    "text/html",
  );
  const { buffer } = await retrieve(url, fetcher);
  const html = new TextDecoder().decode(buffer).trim();
  assertEquals(html, "<div>this is content</div>");
});

Deno.test("retrieve - custom fetcher", async () => {
  const url = "https://some.where/good/source-with-fetcher";
  const innerFetcher = createMockFetcher(
    "<div>this is content</div>",
    "text/html",
  );
  const myFetcher = (fetchUrl: string) => {
    assertEquals(fetchUrl, url);
    return innerFetcher();
  };
  const { buffer } = await retrieve(url, myFetcher);
  const html = new TextDecoder().decode(buffer);
  assertEquals(html, "<div>this is content</div>");
});

Deno.test("retrieve - exposes final url after redirect", async () => {
  const url = "https://some.where/old/page";
  const finalUrl = "https://some.where/new/page";
  const fetcher = () => {
    const res = new Response("<div>this is content</div>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(res, "url", { value: finalUrl });
    return Promise.resolve(res);
  };
  const result = await retrieve(url, fetcher);
  assertEquals(result.url, finalUrl);
});
