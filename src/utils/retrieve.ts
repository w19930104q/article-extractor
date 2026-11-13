// utils -> retrieve.ts

import type { Fetcher } from "../types.ts";

export interface RetrievedResource {
  /** Raw response body bytes. */
  bytes: Uint8Array;
  /** Final URL after redirects. Empty string when the fetcher does not expose one. */
  finalUrl: string;
  /** HTTP Content-Type header value. */
  contentType: string | null;
}

export interface RetrieveOptions {
  /**
   * Maximum number of response body bytes to accept. The body is read
   * incrementally and the count is checked on every chunk. As soon as the
   * limit is exceeded, reading is aborted and the body is cancelled — no
   * partial article is ever returned. Omit (or set to 0) for no limit.
   */
  maxResponseBytes?: number;
}

const concat = (chunks: Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Fetch a resource and collect its body as raw bytes, counting bytes while
 * reading so that an optional size cap can be enforced without ever
 * buffering more than `maxResponseBytes + one chunk`.
 */
export default async (
  url: string,
  fetcher: Fetcher,
  options: RetrieveOptions = {},
): Promise<RetrievedResource> => {
  const { maxResponseBytes = 0 } = options;

  if (
    maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0)
  ) {
    throw new Error("maxResponseBytes must be a non-negative integer");
  }

  const res = await fetcher(url);

  const status = res.status;
  if (status >= 400) {
    throw new Error(`Request failed with error code ${status}`);
  }

  const contentType = res.headers.get("content-type");

  // Null-body responses (e.g. 204) legitimately carry no bytes.
  if (!res.body) {
    return {
      bytes: new Uint8Array(0),
      finalUrl: res.url || url,
      contentType,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value as Uint8Array;
      total += chunk.length;

      if (maxResponseBytes > 0 && total > maxResponseBytes) {
        // Cancel immediately so the underlying connection/socket is
        // released. Swallow cancellation reason errors: the important
        // outcome is the size-limit error below.
        try {
          await reader.cancel();
        } catch {
          // ignore: the stream may already be tearing down
        }
        throw new Error(
          `Response body exceeds the limit of ${maxResponseBytes} bytes ` +
            `(read ${total} bytes)`,
        );
      }

      chunks.push(chunk);
    }
  } finally {
    // Release the reader lock on every exit path.
    reader.releaseLock();
  }

  return {
    bytes: concat(chunks, total),
    finalUrl: res.url || url,
    contentType,
  };
};
