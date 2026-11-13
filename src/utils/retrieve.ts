// utils -> retrieve.ts

export type RetrieveResult = {
  buffer: ArrayBuffer;
  url: string;
};

export default async (
  url: string,
  fetcher: (url: string) => Promise<Response>,
): Promise<RetrieveResult> => {
  const res = await fetcher(url);

  const status = res.status;
  if (status >= 400) {
    throw new Error(`Request failed with error code ${status}`);
  }
  const buffer = await res.arrayBuffer();
  return {
    buffer,
    url: res.url || url,
  };
};
