// extractArticleLd.test.ts

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DOMParser } from "linkedom";

import extractArticleLd from "../src/utils/extractArticleLd.ts";
import { extract, extractFromHtml } from "../src/main.ts";
import { createMockFetcher } from "./helpers.ts";

const pageUrl = "https://example.com/news/article";

const parse = (ldJson: unknown): Document => {
  const scripts = (Array.isArray(ldJson) ? ldJson : [ldJson])
    .map((block) =>
      `<script type="application/ld+json">${JSON.stringify(block)}</script>`
    )
    .join("\n");
  const html = `<html><head>${scripts}</head><body></body></html>`;
  return new DOMParser().parseFromString(
    html,
    "text/html",
  ) as unknown as Document;
};

const articleBody = () =>
  `<p>${"The quick brown fox jumps over the lazy dog. ".repeat(12)}</p>`;

// A complete, extractable HTML page with given JSON-LD blocks and HTML meta.
const buildPage = (ldBlocks: unknown[], meta = ""): string => {
  const scripts = ldBlocks.map((block) =>
    `<script type="application/ld+json">${JSON.stringify(block)}</script>`
  ).join("\n");
  return `<html><head>
<title>HTML title</title>
<link rel="canonical" href="${pageUrl}">
${meta}
${scripts}
</head><body><article><h1>HTML title</h1>${articleBody()}</article></body></html>`;
};

Deno.test("extractArticleLd - selects article matching mainEntityOfPage", () => {
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "@id": "https://example.com/other#article",
      headline: "Other article",
      mainEntityOfPage: "https://example.com/other",
    },
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "@id": "#article",
      headline: "Matching headline",
      author: { "@type": "Person", name: "Matching Author" },
      image: {
        "@type": "ImageObject",
        contentUrl: "https://cdn.example.com/matching.jpg",
        url: "https://cdn.example.com/should-not-win.jpg",
      },
      datePublished: "2026-03-04T05:06:07Z",
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": pageUrl,
      },
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.title, "Matching headline");
  assertEquals(result.author, "Matching Author");
  assertEquals(result.image, "https://cdn.example.com/matching.jpg");
  assertEquals(result.published, "2026-03-04T05:06:07Z");
});

Deno.test("extractArticleLd - falls back to url match then first candidate", () => {
  const byUrl = [
    {
      "@type": "Article",
      headline: "First but unrelated",
      url: "https://example.com/somewhere-else",
    },
    {
      "@type": "NewsArticle",
      headline: "Wins by url",
      url: pageUrl,
    },
  ];
  const byUrlResult = extractArticleLd(parse(byUrl), pageUrl);
  assertEquals(byUrlResult.title, "Wins by url");

  const noMatch = [
    { "@type": "Article", headline: "First candidate" },
    { "@type": "NewsArticle", headline: "Second candidate" },
  ];
  const firstResult = extractArticleLd(parse(noMatch), pageUrl);
  assertEquals(firstResult.title, "First candidate");
});

Deno.test("extractArticleLd - reads nodes from top-level arrays and @graph", () => {
  const ld = [
    [
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            name: "Not an article",
          },
          {
            "@type": "Article",
            "@id": "#graph-article",
            headline: "Inside graph",
            mainEntityOfPage: pageUrl,
          },
        ],
      },
    ],
    {
      "@type": "NewsArticle",
      headline: "Second script article",
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.title, "Inside graph");
});

Deno.test("extractArticleLd - resolves cross-block references by @id", () => {
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": "#author-1",
      name: "Referenced Author",
    },
    {
      "@context": "https://schema.org",
      "@type": "ImageObject",
      "@id": "#image-1",
      contentUrl: "https://cdn.example.com/from-id.jpg",
    },
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "@id": "#article-1",
      headline: "Article with refs",
      author: { "@id": "#author-1" },
      image: { "@id": "#image-1" },
      mainEntityOfPage: pageUrl,
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.author, "Referenced Author");
  assertEquals(result.image, "https://cdn.example.com/from-id.jpg");
});

Deno.test("extractArticleLd - relative @id resolves against page URL", () => {
  const ld = [
    {
      "@type": "Person",
      "@id": "https://example.com/news/team#bob",
      name: "Absolute Id Author",
    },
    {
      "@type": "Article",
      headline: "Absolute id article",
      author: { "@id": "team#bob" },
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.author, "Absolute Id Author");
});

Deno.test("extractArticleLd - duplicate @id definitions keep the first node", () => {
  const ld = [
    { "@type": "Person", "@id": "#author", name: "First Author" },
    { "@type": "Person", "@id": "#author", name: "Second Author" },
    {
      "@type": "Article",
      headline: "Dup id article",
      author: { "@id": "#author" },
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.author, "First Author");
});

Deno.test("extractArticleLd - author/image arrays take the first item", () => {
  const ld = {
    "@type": "Article",
    headline: "Array article",
    author: [
      { "@type": "Person", name: "First Author" },
      { "@type": "Person", name: "Second Author" },
    ],
    image: [
      "https://cdn.example.com/first.jpg",
      "https://cdn.example.com/second.jpg",
    ],
  };
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.author, "First Author");
  assertEquals(result.image, "https://cdn.example.com/first.jpg");
});

Deno.test("extractArticleLd - image uses contentUrl then url", () => {
  const withContentUrl = extractArticleLd(
    parse({
      "@type": "Article",
      image: {
        contentUrl: "https://cdn.example.com/c.jpg",
        url: "https://cdn.example.com/u.jpg",
      },
    }),
    pageUrl,
  );
  assertEquals(withContentUrl.image, "https://cdn.example.com/c.jpg");

  const withUrlOnly = extractArticleLd(
    parse({
      "@type": "Article",
      image: { "@type": "ImageObject", url: "https://cdn.example.com/u.jpg" },
    }),
    pageUrl,
  );
  assertEquals(withUrlOnly.image, "https://cdn.example.com/u.jpg");
});

Deno.test("extractArticleLd - dangling reference leaves the field absent", () => {
  const ld = {
    "@type": "Article",
    headline: "Dangling article",
    author: { "@id": "#missing-author" },
    image: { "@id": "#missing-image" },
  };
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.title, "Dangling article");
  assertEquals("author" in result, false);
  assertEquals("image" in result, false);
});

Deno.test("extractArticleLd - circular references leave the field absent", () => {
  const ld = [
    {
      // An indexed node whose author points back at itself: resolving the
      // author must terminate and leave the field absent instead of looping.
      "@type": "Article",
      "@id": "#self-loop",
      headline: "Loop article",
      author: { "@id": "#self-loop" },
    },
    {
      "@type": "Person",
      "@id": "#loop-person",
      name: "Looping Person",
      knows: { "@id": "#self-loop" },
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  assertEquals(result.title, "Loop article");
  assertEquals("author" in result, false);
});

Deno.test("extractArticleLd - cyclic mainEntityOfPage does not hang", () => {
  const ld = [
    {
      "@type": "WebPage",
      "@id": "#page-a",
      mainEntity: { "@id": "#article-a" },
    },
    {
      "@type": "WebPage",
      "@id": "#page-b",
      mainEntity: { "@id": "#page-a" },
    },
    {
      "@type": "Article",
      "@id": "#article-a",
      headline: "Cyclic page article",
      // two nodes referencing each other, neither carrying the page URL
      mainEntityOfPage: { "@id": "#page-b" },
    },
  ];
  const result = extractArticleLd(parse(ld), pageUrl);
  // matching fails safely; the first (and only) article is still selected
  assertEquals(result.title, "Cyclic page article");
});

Deno.test("extractArticleLd - string author and image are supported", () => {
  const result = extractArticleLd(
    parse({
      "@type": "Article",
      headline: "Scalar article",
      author: "Plain String Author",
      image: "https://cdn.example.com/plain.jpg",
    }),
    pageUrl,
  );
  assertEquals(result.author, "Plain String Author");
  assertEquals(result.image, "https://cdn.example.com/plain.jpg");
});

Deno.test("extractArticleLd - ignores non-article types and malformed JSON", () => {
  const doc = new DOMParser().parseFromString(
    `<html><head>
<script type="application/ld+json">{ not valid json</script>
<script type="application/ld+json">{"@type":"WebPage","headline":"x"}</script>
<script type="application/ld+json">{"@type":["Article","SomeOther"],"headline":"Multi type article"}</script>
</head><body></body></html>`,
    "text/html",
  ) as unknown as Document;
  const result = extractArticleLd(doc, pageUrl);
  assertEquals(result.title, "Multi type article");
});

Deno.test("extractArticleLd - no candidate returns empty object", () => {
  const result = extractArticleLd(parse({ "@type": "WebSite" }), pageUrl);
  assertEquals(result, {});
});

Deno.test("extractArticleLd - works without a page URL", () => {
  const result = extractArticleLd(
    parse({ "@type": "Article", headline: "No page url" }),
    "",
  );
  assertEquals(result.title, "No page url");
});

Deno.test("integration - JSON-LD fields override HTML meta when enabled", async () => {
  const html = buildPage(
    [
      {
        "@type": "NewsArticle",
        headline: "JSON-LD headline",
        author: { name: "JSON-LD Author" },
        image: "https://cdn.example.com/ld.jpg",
        datePublished: "2026-03-04T05:06:07Z",
        mainEntityOfPage: pageUrl,
      },
    ],
    `
<meta property="og:title" content="Meta title">
<meta name="author" content="Meta Author">
<meta property="og:image" content="https://cdn.example.com/meta.jpg">
<meta property="article:published_time" content="2020-01-01T00:00:00Z">
`,
  );
  const result = await extractFromHtml(html, pageUrl, { useJsonLd: true });
  assertEquals(result?.title, "JSON-LD headline");
  assertEquals(result?.author, "JSON-LD Author");
  assertEquals(result?.image, "https://cdn.example.com/ld.jpg");
  assertEquals(result?.published, "2026-03-04T05:06:07.000Z");
  // content extraction is untouched
  assert((result?.content || "").includes("quick brown fox"));
});

Deno.test("integration - missing JSON-LD fields only fall back to HTML meta", async () => {
  const html = buildPage(
    [
      {
        // headline and datePublished are intentionally absent
        "@type": "Article",
        author: { name: "JSON-LD Author" },
        mainEntityOfPage: pageUrl,
      },
    ],
    `
<meta property="og:title" content="Meta title">
<meta property="article:published_time" content="2020-01-01T00:00:00Z">
`,
  );
  const result = await extractFromHtml(html, pageUrl, { useJsonLd: true });
  assertEquals(result?.title, "Meta title");
  assertEquals(result?.author, "JSON-LD Author");
  assertEquals(result?.published, "2020-01-01T00:00:00.000Z");
});

Deno.test("integration - no candidate falls back to legacy behavior", async () => {
  const html = buildPage(
    [
      { "@type": "WebSite", name: "Just a site" },
    ],
    `
<meta property="og:title" content="Meta title">
<meta name="author" content="Meta Author">
`,
  );
  const withFlag = await extractFromHtml(html, pageUrl, { useJsonLd: true });
  const withoutFlag = await extractFromHtml(html, pageUrl);
  assertEquals(withFlag, withoutFlag);
  assertEquals(withFlag?.title, "Meta title");
  assertEquals(withFlag?.author, "Meta Author");
});

Deno.test("integration - default behavior does not apply JSON-LD article mode", async () => {
  const html = buildPage(
    [
      {
        "@type": "NewsArticle",
        headline: "JSON-LD headline",
        author: { name: "JSON-LD Author" },
        datePublished: "2026-03-04T05:06:07Z",
        mainEntityOfPage: pageUrl,
      },
    ],
    `
<meta property="og:title" content="Meta title">
<meta name="author" content="Meta Author">
`,
  );
  const defaultResult = await extractFromHtml(html, pageUrl);
  const optInResult = await extractFromHtml(html, pageUrl, {
    useJsonLd: true,
  });
  assertEquals(defaultResult?.title, "Meta title");
  assertEquals(defaultResult?.author, "Meta Author");
  assertNotEquals(defaultResult?.title, optInResult?.title);
  assertEquals(optInResult?.title, "JSON-LD headline");
});

Deno.test("integration - redirect: article matches the final HTTP URL", async () => {
  const oldUrl = "https://example.com/old-slug";
  const html = buildPage([
    {
      "@type": "Article",
      headline: "Final URL article",
      author: { name: "Final Author" },
      mainEntityOfPage: pageUrl,
    },
    {
      "@type": "Article",
      headline: "Old URL article",
      mainEntityOfPage: oldUrl,
    },
  ]);
  const fetcher = () => {
    const res = new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(res, "url", { value: pageUrl });
    return Promise.resolve(res);
  };
  const result = await extract(oldUrl, { useJsonLd: true }, fetcher);
  assertEquals(result?.title, "Final URL article");
  assertEquals(result?.author, "Final Author");
  // the redirect fetcher is the only network access the library performs
  const noNetworkFetcher = createMockFetcher(html, "text/html");
  const offline = await extract(pageUrl, { useJsonLd: true }, noNetworkFetcher);
  assertEquals(offline?.title, "Final URL article");
});
