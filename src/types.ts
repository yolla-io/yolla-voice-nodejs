import type { components, paths } from "./generated/openapi.js";

export type { components, paths };

type Schemas = components["schemas"];

export type Money = Schemas["Money"];
export type Rate = Schemas["Rate"];
export type Destination = Schemas["Destination"];
export type CallStatus = Schemas["CallStatus"];
export type EndReason = Schemas["EndReason"];
export type QualitySummary = Schemas["QualitySummary"];
export type Call = Schemas["Call"];
export type CreateCallParams = Schemas["CreateCallRequest"];
export type CreateCallResponse = Schemas["CreateCallResponse"];
export type Balance = Schemas["Balance"];
export type NumberPrice = Schemas["NumberPrice"];
export type ErrorBody = Schemas["ErrorBody"];

export type ListCallsParams = NonNullable<paths["/v1/calls"]["get"]["parameters"]["query"]>;

export type CallList = paths["/v1/calls"]["get"]["responses"][200]["content"]["application/json"];
