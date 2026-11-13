// utils -> parseFromHtml.ts

import { getTTR, stripTags, truncateByChar, unique } from "@pwshub/bellajs";
import { DOMParser } from "linkedom";

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

import extractArticleLd from "./extractArticleLd.ts";
import type { ArticleLdData } from "./extractArticleLd.ts";

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
  pageUrl = "",
): Promise<ArticleData | null> => {
  const meta = extractMetaData(inputHtml);

  const {
    wordsPerMinute = 300,
    descriptionTruncateLen = 210,
    descriptionLengthThreshold = 180,
    contentLengthThreshold = 200,
    allowedTags = defaultAllowedTags,
    allowedAttributes = defaultAllowedAttributes,
    allowedIframeDomains = defaultAllowedIframeDomains,
    useJsonLd = false,
  } = parserOptions;

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

  // Opt-in JSON-LD Article/NewsArticle extraction. Only the fields present
  // on the selected JSON-LD article override the HTML meta values; missing
  // fields keep falling back to the meta data below.
  let ldData: ArticleLdData = {};
  if (useJsonLd) {
    const doc = new DOMParser().parseFromString(inputHtml, "text/html");
    ldData = extractArticleLd(doc as unknown as Document, pageUrl || inputUrl);
  }

  let title = ldData.title || meta.title;

  const links = unique(
    [url, shortlink, amphtml, canonical, inputUrl]
      .filter(isValidUrl)
      .map(purifyUrl as (s: string) => string),
  );

  if (!links.length) {
    return null;
  }

  const bestUrl = chooseBestUrl(links, title);

  const normalizedHtml = normalizeUrls(inputHtml, bestUrl);
  const preTransformedHtml = execPreParser(normalizedHtml, links);
  const readabilityExtracted = extractWithReadability(
    preTransformedHtml,
    bestUrl,
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

  const image = (ldData.image || metaImg)
    ? absolutifyUrl(bestUrl, ldData.image || metaImg)
    : "";
  const favicon = metaFav ? absolutifyUrl(bestUrl, metaFav) : "";

  const imgcount = countImages(content);

  return {
    url: bestUrl,
    title,
    description,
    links,
    image,
    content,
    author: ldData.author || author || readabilityExtracted.byline || "",
    favicon,
    source: readabilityExtracted.siteName || getDomain(bestUrl),
    published: fmtIso(
      ldData.published || readabilityExtracted.publishedTime || published,
    ),
    ttr: getTTR(textContent, imgcount, wordsPerMinute),
    type,
  };
};
