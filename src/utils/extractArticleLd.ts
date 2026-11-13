// utils -> extractArticleLd.ts
//
// Opt-in extraction of Article/NewsArticle data from JSON-LD blocks
// (`<script type="application/ld+json">`). Nodes can live in top-level
// arrays or inside `@graph`, in any script block on the page. References
// between nodes use `@id`, resolved against the page URL. No remote
// `@context` document is ever fetched.

import { isArray, isObject, isString } from "@pwshub/bellajs";

type LdNode = Record<string, unknown>;

export type ArticleLdData = {
  title?: string;
  author?: string;
  image?: string;
  published?: string;
};

const articleTypes = ["article", "newsarticle"];

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isArticleNode = (node: unknown): node is LdNode => {
  if (!isObject(node)) {
    return false;
  }
  const rawType = (node as LdNode)["@type"];
  const types = isArray(rawType) ? rawType as unknown[] : [rawType];
  return types
    .filter(isString)
    .some((type) => articleTypes.includes((type as string).toLowerCase()));
};

// Resolve a relative `@id` (or any URL reference) against the page URL.
const resolveRef = (ref: string, pageUrl: string): string => {
  if (!pageUrl) {
    return ref;
  }
  try {
    return new URL(ref, pageUrl).toString();
  } catch {
    return ref;
  }
};

const sameUrl = (left: string, right: string): boolean => {
  if (left === right) {
    return true;
  }
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return false;
  }
};

// Flatten every JSON-LD value into the list of candidate nodes, descending
// into top-level arrays and `@graph` arrays in document order.
const collectNodes = (
  value: unknown,
  collected: LdNode[],
): void => {
  if (isArray(value)) {
    (value as unknown[]).forEach((item) => collectNodes(item, collected));
    return;
  }
  if (!isObject(value)) {
    return;
  }
  const node = value as LdNode;
  collected.push(node);
  const graph = node["@graph"];
  if (isArray(graph)) {
    (graph as unknown[]).forEach((item) => collectNodes(item, collected));
  }
};

// Dereference an `@id`-only node. Cycles and dangling references return
// `null`, which makes the consuming field fall back / stay absent.
const dereference = (
  value: unknown,
  index: Map<string, LdNode>,
  pageUrl: string,
  seen: Set<string>,
): LdNode | null => {
  if (!isObject(value)) {
    return null;
  }
  const node = value as LdNode;
  const id = node["@id"];
  if (!isString(id) || !(id as string).trim()) {
    // Inline node without a reference id: use it as-is.
    return node;
  }
  const resolvedId = resolveRef(id as string, pageUrl);
  const target = index.get(resolvedId);
  if (!target) {
    // Dangling reference: nothing indexed under this id.
    return null;
  }
  if (target === node) {
    // Reached the node's own definition.
    return node;
  }
  if (seen.has(resolvedId)) {
    // Reference chain loops back onto itself.
    return null;
  }
  seen.add(resolvedId);
  const resolved = dereference(target, index, pageUrl, seen);
  seen.delete(resolvedId);
  return resolved;
};

const firstItem = (value: unknown): unknown => {
  return isArray(value) ? (value as unknown[])[0] : value;
};

const asString = (value: unknown): string => {
  return isString(value) ? (value as string).trim() : "";
};

const getHeadline = (article: LdNode): string => {
  return asString(article.headline);
};

const getAuthor = (
  article: LdNode,
  index: Map<string, LdNode>,
  pageUrl: string,
): string => {
  const value = firstItem(article.author);
  if (isString(value)) {
    return asString(value);
  }
  const authorNode = dereference(value, index, pageUrl, new Set());
  return authorNode ? asString(authorNode.name) : "";
};

const getImage = (
  article: LdNode,
  index: Map<string, LdNode>,
  pageUrl: string,
): string => {
  const value = firstItem(article.image);
  if (isString(value)) {
    return asString(value);
  }
  const imageNode = dereference(value, index, pageUrl, new Set());
  if (!imageNode) {
    return "";
  }
  return asString(imageNode.contentUrl) || asString(imageNode.url);
};

const getDatePublished = (article: LdNode): string => {
  return asString(article.datePublished);
};

const refMatchesPage = (
  value: unknown,
  index: Map<string, LdNode>,
  pageUrl: string,
  seen: Set<string> = new Set(),
): boolean => {
  if (isString(value)) {
    return sameUrl(resolveRef(value as string, pageUrl), pageUrl);
  }
  if (isObject(value)) {
    const node = value as LdNode;
    if (isString(node["@id"])) {
      const resolvedId = resolveRef(node["@id"] as string, pageUrl);
      if (seen.has(resolvedId)) {
        // Reference chain loops back onto itself.
        return false;
      }
      const target = index.get(resolvedId);
      if (target && target !== node) {
        seen.add(resolvedId);
        return refMatchesPage(target, index, pageUrl, seen);
      }
      return sameUrl(resolvedId, pageUrl);
    }
    if (isString(node.url)) {
      return sameUrl(
        resolveRef(node.url as string, pageUrl),
        pageUrl,
      );
    }
  }
  return false;
};

const matchesPage = (
  article: LdNode,
  index: Map<string, LdNode>,
  pageUrl: string,
): boolean => {
  if (!pageUrl) {
    return false;
  }
  const mainEntity = article.mainEntityOfPage;
  if (
    (isArray(mainEntity) ? mainEntity as unknown[] : [mainEntity])
      .some((item) => refMatchesPage(item, index, pageUrl))
  ) {
    return true;
  }
  const url = article.url;
  return (isArray(url) ? url as unknown[] : [url])
    .some((item) =>
      isString(item) &&
      sameUrl(resolveRef(item as string, pageUrl), pageUrl)
    );
};

/**
 * Extract Article/NewsArticle data from the JSON-LD blocks of a document.
 *
 * @param document - Parsed HTML document
 * @param pageUrl - Final page URL (post-redirect, or the explicit HTML source)
 * @returns Fields found on the selected article; an empty object when no
 *          Article/NewsArticle candidate exists.
 */
export default (
  document: Document,
  pageUrl: string,
): ArticleLdData => {
  const scripts = document.querySelectorAll(
    'script[type="application/ld+json"]',
  );

  const nodes: LdNode[] = [];
  scripts.forEach((script: Element) => {
    const parsed = parseJson(script.textContent || "");
    collectNodes(parsed, nodes);
  });

  // Index every node carrying an `@id`. Duplicate definitions keep the
  // first one encountered in document order.
  const index = new Map<string, LdNode>();
  nodes.forEach((node) => {
    const id = node["@id"];
    if (isString(id) && (id as string).trim()) {
      const resolvedId = resolveRef(id as string, pageUrl);
      if (!index.has(resolvedId)) {
        index.set(resolvedId, node);
      }
    }
  });

  const articles = nodes.filter(isArticleNode);
  if (!articles.length) {
    return {};
  }

  // mainEntityOfPage match, then url match, then first candidate.
  const selected =
    articles.find((article) => matchesPage(article, index, pageUrl)) ||
    articles[0];

  const data: ArticleLdData = {};
  const title = getHeadline(selected);
  if (title) {
    data.title = title;
  }
  const author = getAuthor(selected, index, pageUrl);
  if (author) {
    data.author = author;
  }
  const image = getImage(selected, index, pageUrl);
  if (image) {
    data.image = image;
  }
  const published = getDatePublished(selected);
  if (published) {
    data.published = published;
  }
  return data;
};
