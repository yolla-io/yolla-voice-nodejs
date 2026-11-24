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

/**
 * Awaitable to the first `CallPage` and async-iterable over every `Call` of all pages.
 * No request is made until it is awaited or iterated.
 */
export class CallPagePromise implements PromiseLike<CallPage>, AsyncIterable<Call> {
  readonly #fetchPage: FetchCallPage;
  #first: Promise<CallPage> | undefined;

  constructor(fetchPage: FetchCallPage) {
    this.#fetchPage = fetchPage;
  }

  #firstPage(): Promise<CallPage> {
    this.#first ??= this.#fetchPage(undefined).then((list) => new CallPage(list, this.#fetchPage));
    return this.#first;
  }

  // biome-ignore lint/suspicious/noThenProperty: the list call is intentionally awaitable
  then<R1 = CallPage, R2 = never>(
    onfulfilled?: ((value: CallPage) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.#firstPage().then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Call> {
    let page: CallPage | undefined = await this.#firstPage();
    while (page) {
      yield* page.items;
      page = page.hasNextPage() ? await page.nextPage() : undefined;
    }
  }
}
