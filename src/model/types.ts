/** A row in any key/value table (params, headers, variables, form fields). */
export interface KV {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

/** A multipart form row. For `file` parts, `value` holds the absolute file path. */
export interface FormPart extends KV {
  type: "text" | "file";
}

export type RawLanguage = "json" | "text" | "xml" | "html" | "javascript";
export type BodyMode = "none" | "raw" | "urlencoded" | "formdata" | "binary" | "graphql";

/**
 * Every mode keeps its own content so switching modes in the editor never
 * throws away what was typed in another one.
 */
export interface Body {
  mode: BodyMode;
  raw: string;
  rawLanguage: RawLanguage;
  urlencoded: KV[];
  formdata: FormPart[];
  binaryPath: string;
  graphqlQuery: string;
  graphqlVariables: string;
}

export type Auth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "apikey"; key: string; value: string; in: "header" | "query" }
  /** An auth type zman cannot apply. Kept verbatim so export does not lose it. */
  | { type: "unsupported"; postmanType: string; raw: unknown };

export interface RequestDef {
  method: string;
  /** Raw URL as typed, including the query string of all enabled params. */
  url: string;
  /** Query params table. Enabled rows mirror the query string in `url`. */
  params: KV[];
  /** Values for `:name` path segments in `url`. */
  pathVars: KV[];
  headers: KV[];
  body: Body;
  auth: Auth;
}

/** Postman data zman does not interpret but writes back on export. */
export interface PostmanPassthrough {
  event?: unknown;
  response?: unknown;
  protocolProfileBehavior?: unknown;
}

export interface RequestItem {
  type: "request";
  id: string;
  name: string;
  description?: string;
  request: RequestDef;
  postman?: PostmanPassthrough;
}

export interface FolderItem {
  type: "folder";
  id: string;
  name: string;
  description?: string;
  auth: Auth;
  items: Item[];
  postman?: PostmanPassthrough;
}

export type Item = RequestItem | FolderItem;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  /** `inherit` at the collection root means "no auth". */
  auth: Auth;
  variables: KV[];
  items: Item[];
  postman?: PostmanPassthrough;
}

export interface Environment {
  id: string;
  name: string;
  variables: KV[];
}

/* ---------- Wire types shared with the Rust side ---------- */

export type SpecBody =
  | { kind: "none" }
  | { kind: "raw"; text: string }
  | { kind: "urlencoded"; fields: [string, string][] }
  | { kind: "formdata"; parts: SpecFormPart[] }
  | { kind: "binary"; path: string };

export type SpecFormPart =
  | { kind: "text"; name: string; value: string }
  | { kind: "file"; name: string; path: string };

export type ProxySetting = { mode: "system" } | { mode: "none" } | { mode: "custom"; url: string };

export interface RequestOptions {
  /** 0 disables the timeout. */
  timeoutMs: number;
  followRedirects: boolean;
  verifySsl: boolean;
  proxy: ProxySetting;
}

export interface HttpRequestSpec {
  method: string;
  url: string;
  headers: [string, string][];
  body: SpecBody;
  options: RequestOptions;
}

export type ResponseBody = { kind: "text"; text: string } | { kind: "base64"; data: string };

export interface HttpResponseData {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  body: ResponseBody;
  sizeBytes: number;
  timeMs: number;
  finalUrl: string;
}

export interface HttpError {
  kind: "cancelled" | "timeout" | "connect" | "tls" | "invalidRequest" | "file" | "tooLarge" | "other";
  message: string;
}

/* ---------- App state ---------- */

export interface HistoryEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  name: string;
  request: RequestDef;
  /** URL actually sent, after variable substitution. */
  resolvedUrl: string;
  status?: number;
  timeMs?: number;
  sizeBytes?: number;
  error?: string;
  /** The saved request this was sent from, if it was saved at the time. */
  source?: { collectionId: string; requestId: string };
}

export interface Settings {
  timeoutMs: number;
  followRedirects: boolean;
  verifySsl: boolean;
  proxy: ProxySetting;
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  timeoutMs: 0,
  followRedirects: true,
  verifySsl: true,
  proxy: { mode: "system" },
  theme: "system",
};

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
