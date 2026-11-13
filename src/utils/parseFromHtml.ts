// utils -> parseFromHtml.ts

import { getTTR, stripTags, truncateByChar, unique } from "@pwshub/bellajs";

import { cleanify, countImages } from "./html.ts";

import {
  absolutify as absolutifyUrl,
  chooseBestUrl,
  getDomain,
  isValid as isValidUrl,
  normalize as normalizeUrls,
  purify as purifyUrl,
} from "./linker.ts";

import extractMetaData from "./extractMetaData.ts";

import extractWithReadability from "./extractWithReadability.ts";

import { execPostParser, execPreParser } from "./transformation.ts";

import {
  defaultAllowedAttributes,
  defaultAllowedIframeDomains,
  defaultAllowedTags,
} from "../config.ts";

import type { ArticleData, ParserOptions } from "../types.ts";

const fmtIso = (input: string): string => {
  try {
    return (new Date(input)).toISOString();
  } catch {
    return input;
  }
};

const summarize = (
  { desc, text, threshold, maxlen }: {
    desc: string;
    text: string;
    threshold: number;
    maxlen: number;
  },
): string => {
  return desc.length > threshold
    ? desc
    : truncateByChar(text, maxlen).replace(/\n/g, " ");
};

// deno-lint-ignore require-await
export default async (
  inputHtml: string,
  inputUrl = "",
  parserOptions: ParserOptions = {},
  /**
   * URL used as the base for resolving relative links, images and the
   * document-declared `<base href>`. For URL input this is the response's
   * final URL. When empty (pure HTML entry point), resolution falls back to
   * the best (canonical) URL discovered inside the document, preserving the
   * historical behavior.
   */
  baseUrl = "",
): Promise<ArticleData | null> => {
  const meta = extractMetaData(inputHtml);

  let title = meta.title;

  const {
    url,
    shortlink,
    amphtml,
    canonical,
    description: metaDesc,
    image: metaImg,
    author,
    published,
    favicon: metaFav,
    type,
  } = meta;

  const {
    wordsPerMinute = 300,
    descriptionTruncateLen = 210,
    descriptionLengthThreshold = 180,
    contentLengthThreshold = 200,
    allowedTags = defaultAllowedTags,
    allowedAttributes = defaultAllowedAttributes,
    allowedIframeDomains = defaultAllowedIframeDomains,
  } = parserOptions;

  const links = unique(
    [url, shortlink, amphtml, canonical, inputUrl]
      .filter(isValidUrl)
      .map(purifyUrl as (s: string) => string),
  );

  if (!links.length) {
    return null;
  }

  const bestUrl = chooseBestUrl(links, title);

  // Resource resolution is anchored to the response's final URL; the
  // canonical/best URL only identifies the article. For the pure HTML
  // entry point no response URL exists, so keep the legacy behavior and
  // resolve against the best (canonical) URL discovered in the document.
  const effectiveBase = baseUrl || bestUrl;
  const normalizedHtml = normalizeUrls(inputHtml, effectiveBase);
  const preTransformedHtml = execPreParser(normalizedHtml, links);
  const readabilityExtracted = extractWithReadability(
    preTransformedHtml,
    effectiveBase,
  );

  if (!readabilityExtracted) {
    return null;
  }

  const extractedContent = readabilityExtracted.content;
  const postTransformedHtml = execPostParser(extractedContent, links);
  const content = cleanify(postTransformedHtml, {
    allowedTags,
    allowedAttributes,
    allowedIframeDomains,
  });

  if (!content) {
    return null;
  }

  if (!title) {
    title = readabilityExtracted.title;
  }

  const textContent = stripTags(content);
  if (textContent.length < contentLengthThreshold) {
    return null;
  }

  const description = summarize({
    desc: readabilityExtracted.excerpt || metaDesc,
    text: textContent,
    threshold: descriptionLengthThreshold,
    maxlen: descriptionTruncateLen,
  });

  const image = metaImg ? absolutifyUrl(effectiveBase, metaImg) : "";
  const favicon = metaFav ? absolutifyUrl(effectiveBase, metaFav) : "";

  const imgcount = countImages(content);

  return {
    url: bestUrl,
    title,
    description,
    links,
    image,
    content,
    author: author || readabilityExtracted.byline || "",
    favicon,
    source: readabilityExtracted.siteName || getDomain(bestUrl),
    published: fmtIso(readabilityExtracted.publishedTime || published),
    ttr: getTTR(textContent, imgcount, wordsPerMinute),
    type,
  };
};
