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

/** Mock fetcher returning raw bytes with a configurable Content-Type. */
export const createMockByteFetcher = (
  bytes: Uint8Array | ArrayBuffer,
  contentType: string,
  status = 200,
) => {
  const body = bytes instanceof Uint8Array
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes);
  return () =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-type": contentType },
      }),
    );
};

/** Read a committed byte fixture from tests/test-data/bytes. */
export const readByteFixture = (name: string): Uint8Array => {
  return Deno.readFileSync(`tests/test-data/bytes/${name}`);
};
