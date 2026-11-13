// utils -> retrieve.ts

export type RetrievedResource = {
  buffer: ArrayBuffer;
  /** Content-Type header of the final response (after redirects). */
  contentType: string | null;
};

/**
 * Fetch a URL and return its raw bytes together with the final response's
 * Content-Type header. The existing HTTP error semantics are preserved:
 * any status code >= 400 rejects with an Error.
 */
export const retrieveResource = async (
  url: string,
  fetcher: (url: string) => Promise<Response>,
): Promise<RetrievedResource> => {
  const res = await fetcher(url);

  const status = res.status;
  if (status >= 400) {
    throw new Error(`Request failed with error code ${status}`);
  }

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type");
  return { buffer, contentType };
};

export default async (
  url: string,
  fetcher: (url: string) => Promise<Response>,
): Promise<ArrayBuffer> => {
  const { buffer } = await retrieveResource(url, fetcher);
  return buffer;
};
