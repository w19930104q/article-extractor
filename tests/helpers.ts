// tests/helpers.ts

export const createMockFetcher = (
  body: string,
  contentType: string,
  status = 200,
) => {
  return () =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-type": contentType },
      }),
    );
};

/** Build a Response whose `url` reports a final (post-redirect) location. */
export const createResponseWithUrl = (
  body: BodyInit | null,
  finalUrl: string,
  init: ResponseInit = {},
): Response => {
  const res = new Response(body, init);
  Object.defineProperty(res, "url", { value: finalUrl });
  return res;
};

/** Split bytes into chunks of the given sizes (last chunk takes the rest). */
export const chunkBytes = (
  bytes: Uint8Array,
  sizes: number[],
): Uint8Array[] => {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) {
    chunks.push(bytes.subarray(offset));
  }
  return chunks;
};

export interface StreamFetcherOptions {
  contentType?: string;
  finalUrl?: string;
  /** Called when the response body stream is cancelled. */
  onCancel?: () => void;
  status?: number;
}

/**
 * Create a fetcher returning a Response backed by a ReadableStream that
 * emits the given chunks one per pull — fully offline, no network. Because
 * chunks are enqueued on demand, cancelling the stream mid-read reliably
 * invokes the underlying `cancel()` hook.
 */
export const createChunkedStreamFetcher = (
  chunks: Uint8Array[],
  options: StreamFetcherOptions = {},
) => {
  const {
    contentType = "text/html",
    finalUrl = "",
    onCancel,
    status = 200,
  } = options;
  return (): Promise<Response> => {
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index]);
          index += 1;
        } else {
          controller.close();
        }
      },
      cancel() {
        onCancel?.();
      },
    });
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = contentType;
    const res = new Response(stream, { status, headers });
    if (finalUrl) {
      Object.defineProperty(res, "url", { value: finalUrl });
    }
    return Promise.resolve(res);
  };
};

/**
 * Encode an HTML template containing CJK markers as GB18030 bytes.
 * ASCII characters are emitted as-is; the small GBK lookup table below
 * covers every non-ASCII character used by the offline test fixtures.
 */
export const encodeGb18030 = (asciiHtml: string): Uint8Array => {
  const gbk: Record<string, number[]> = {
    "中": [0xd6, 0xd0],
    "文": [0xce, 0xc4],
    "标": [0xb1, 0xea],
    "题": [0xcc, 0xe2],
    "页": [0xd2, 0xb3],
    "面": [0xc3, 0xe6],
    "内": [0xc4, 0xda],
    "容": [0xc8, 0xdd],
    "测": [0xb2, 0xe2],
    "试": [0xca, 0xd4],
  };
  const parts: number[] = [];
  for (const ch of asciiHtml) {
    if (gbk[ch]) {
      parts.push(...gbk[ch]);
    } else {
      const code = ch.codePointAt(0) as number;
      if (code > 0x7f) {
        throw new Error(
          `Fixture helper has no GBK mapping for ${ch}; add it to the table`,
        );
      }
      parts.push(code);
    }
  }
  return new Uint8Array(parts);
};
