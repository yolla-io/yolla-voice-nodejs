import { describe, expectTypeOf, it } from "vitest";
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

  it("types CallList.nextCursor as string or null", () => {
    expectTypeOf<CallList["nextCursor"]>().toEqualTypeOf<string | null>();
  });

  it("types ListCallsParams.limit as optional number", () => {
    expectTypeOf<ListCallsParams["limit"]>().toEqualTypeOf<number | undefined>();
  });
});
