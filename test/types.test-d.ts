import { describe, expectTypeOf, it } from "vitest";
import type { YollaVoice } from "../src/client.js";
import type { CallPage } from "../src/pagination.js";
import type {
  Call,
  CallList,
  CallStatus,
  CreateCallParams,
  ListCallsParams,
} from "../src/types.js";

describe("types", () => {
  it("requires to and externalUserId on CreateCallParams", () => {
    expectTypeOf<CreateCallParams>().toHaveProperty("to");
    expectTypeOf<CreateCallParams>().toHaveProperty("externalUserId");
    expectTypeOf<{ to: CreateCallParams["to"] }>().not.toMatchTypeOf<CreateCallParams>();
    expectTypeOf<{
      to: CreateCallParams["to"];
      externalUserId: string;
    }>().toMatchTypeOf<CreateCallParams>();
  });

  it("uses CallStatus for Call.status", () => {
    expectTypeOf<Call["status"]>().toEqualTypeOf<CallStatus>();
  });

  it("types CallList.nextCursor as the contract does: optional string or null", () => {
    expectTypeOf<CallList["nextCursor"]>().toEqualTypeOf<string | null | undefined>();
  });

  it("types ListCallsParams.limit as optional number", () => {
    expectTypeOf<ListCallsParams["limit"]>().toEqualTypeOf<number | undefined>();
  });

  it("types calls.list() as a promise of the first page and an iterable of calls", () => {
    type List = ReturnType<YollaVoice["calls"]["list"]>;
    expectTypeOf<List>().toMatchTypeOf<Promise<CallPage>>();
    expectTypeOf<List>().toMatchTypeOf<AsyncIterable<Call>>();
    expectTypeOf<List["catch"]>().toBeFunction();
    expectTypeOf<List["finally"]>().toBeFunction();
  });
});
