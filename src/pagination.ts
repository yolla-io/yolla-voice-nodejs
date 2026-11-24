import type { Call, CallList } from "./types.js";

/** Fetches the page that starts at the given cursor (undefined for the first page). */
export type FetchCallPage = (cursor: string | undefined) => Promise<CallList>;

/** One page of calls. */
export class CallPage {
  readonly items: Call[];
  readonly nextCursor: string | null;
  readonly #fetchPage: FetchCallPage;

  constructor(list: CallList, fetchPage: FetchCallPage) {
    this.items = list.items;
    this.nextCursor = list.nextCursor ?? null;
    this.#fetchPage = fetchPage;
  }

  hasNextPage(): boolean {
    return this.nextCursor !== null;
  }

  /** Fetches the next page; throws if there is none. */
  async nextPage(): Promise<CallPage> {
    if (this.nextCursor === null) throw new Error("There is no next page");
    return new CallPage(await this.#fetchPage(this.nextCursor), this.#fetchPage);
  }
}

/** The first `CallPage`, and also an async iterable over every `Call` of all pages. */
export type CallPagePromise = Promise<CallPage> & AsyncIterable<Call>;

/** Sends the first page request at once; iteration follows `nextCursor` lazily. */
export function listCallPages(fetchPage: FetchCallPage): CallPagePromise {
  const first = fetchPage(undefined).then((list) => new CallPage(list, fetchPage));
  return Object.assign(first, {
    async *[Symbol.asyncIterator](): AsyncGenerator<Call> {
      let page: CallPage | undefined = await first;
      while (page) {
        yield* page.items;
        page = page.hasNextPage() ? await page.nextPage() : undefined;
      }
    },
  });
}
