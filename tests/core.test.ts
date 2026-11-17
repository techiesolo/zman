import { describe, expect, it } from "vitest";
import { buildRequest, effectiveAuth } from "../src/lib/buildRequest";
import { contentKind, formatBytes, formatDuration, parseSetCookies, prettyJson } from "../src/lib/format";
import {
  appendQueryParam,
  applyPathVars,
  normalizeUrl,
  pathVarNames,
  setUrlQuery,
  syncParamsFromUrl,
  syncPathVars,
} from "../src/lib/url";
import { buildVarMap, findVariableTokens, resolveVariables } from "../src/lib/variables";
import { emptyRequest, formPart, kv, newCollection, newFolder } from "../src/model/factory";
import { DEFAULT_SETTINGS, type Auth, type RequestDef } from "../src/model/types";

describe("variables", () => {
  const vars = buildVarMap(
    [kv("host", "global.example.com"), kv("only_global", "g")],
    [kv("host", "collection.example.com"), kv("off", "x", false)],
    [kv("host", "env.example.com"), kv("base", "https://{{host}}/v1")],
  );

  it("lets the environment win over collection and globals", () => {
    expect(vars.get("host")).toBe("env.example.com");
    expect(vars.get("only_global")).toBe("g");
    expect(vars.has("off")).toBe(false);
  });

  it("substitutes, including values that reference other variables", () => {
    expect(resolveVariables("{{base}}/users?g={{ only_global }}", vars)).toBe("https://env.example.com/v1/users?g=g");
  });

  it("leaves unknown variables in place", () => {
    expect(resolveVariables("{{nope}}/{{host}}", vars)).toBe("{{nope}}/env.example.com");
  });

  it("stops on reference cycles", () => {
    const cyclic = buildVarMap([kv("a", "{{b}}"), kv("b", "{{a}}")]);
    expect(resolveVariables("{{a}}", cyclic)).toMatch(/^\{\{[ab]\}\}$/);
  });

  it("supports dynamic variables", () => {
    expect(resolveVariables("{{$guid}}", vars)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveVariables("{{$timestamp}}", vars)).toMatch(/^\d{10}$/);
    expect(Number(resolveVariables("{{$randomInt}}", vars))).toBeLessThanOrEqual(1000);
  });

  it("finds tokens for highlighting", () => {
    expect(findVariableTokens("a {{host}} b {{missing}} {{$guid}}", vars)).toEqual([
      { name: "host", from: 2, to: 10, resolved: true },
      { name: "missing", from: 13, to: 24, resolved: false },
      { name: "$guid", from: 25, to: 34, resolved: true },
    ]);
  });
});

describe("url <-> params sync", () => {
  it("rebuilds params from the URL and keeps disabled rows", () => {
    const prev = [kv("a", "1"), kv("hidden", "x", false), kv("b", "2")];
    const next = syncParamsFromUrl("http://h/p?a=9&c=3&d", prev);
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ["a", "9", true],
      ["hidden", "x", false],
      ["c", "3", true],
      ["d", "", true],
    ]);
    expect(next[0]!.id).toBe(prev[0]!.id);
    expect(next[1]).toBe(prev[1]);
  });

  it("returns the same rows when nothing changed", () => {
    const prev = [kv("a", "1")];
    expect(syncParamsFromUrl("http://h/?a=1", prev)[0]).toBe(prev[0]);
  });

  it("drops params removed from the URL", () => {
    expect(syncParamsFromUrl("http://h/p", [kv("a", "1"), kv("off", "1", false)]).map((p) => p.key)).toEqual(["off"]);
  });

  it("writes enabled params back into the URL, keeping the fragment", () => {
    const params = [kv("a", "1"), kv("b", "{{x}}"), kv("off", "1", false), kv("", "")];
    expect(setUrlQuery("{{base}}/p?old=1#top", params)).toBe("{{base}}/p?a=1&b={{x}}#top");
    expect(setUrlQuery("http://h/p?old=1", [])).toBe("http://h/p");
  });

  it("finds path variables but not ports", () => {
    expect(pathVarNames("http://localhost:8080/users/:id/posts/:postId?x=:nope")).toEqual(["id", "postId"]);
    expect(pathVarNames("{{base}}/:a/:a")).toEqual(["a"]);
  });

  it("keeps path variable values across URL edits", () => {
    const prev = [kv("id", "7")];
    expect(syncPathVars("http://h/:id", prev)).toBe(prev);
    const next = syncPathVars("http://h/:org/:id", prev);
    expect(next.map((p) => [p.key, p.value])).toEqual([
      ["org", ""],
      ["id", "7"],
    ]);
  });

  it("applies path variables with encoding", () => {
    expect(applyPathVars("http://h:80/u/:id/x/:missing?q=1", { id: "a b/c" })).toBe(
      "http://h:80/u/a%20b%2Fc/x/:missing?q=1",
    );
  });

  it("normalizes URLs for sending", () => {
    expect(normalizeUrl("example.com/a b?q=x y")).toBe("http://example.com/a%20b?q=x%20y");
    expect(normalizeUrl(" https://example.com/%20ok ")).toBe("https://example.com/%20ok");
    expect(() => normalizeUrl("")).toThrow(/empty/);
    expect(() => normalizeUrl("http://")).toThrow(/not a valid URL/);
    expect(() => normalizeUrl("ftp://example.com")).toThrow(/Unsupported protocol/);
  });

  it("appends query params", () => {
    expect(appendQueryParam("http://h/p", "k", "a b")).toBe("http://h/p?k=a%20b");
    expect(appendQueryParam("http://h/p?x=1#f", "k", "v")).toBe("http://h/p?x=1&k=v#f");
  });
});

describe("buildRequest", () => {
  const vars = buildVarMap([kv("base", "https://api.test"), kv("token", "t0k"), kv("id", "5")]);
  const build = (patch: Partial<RequestDef>, auth: Auth = { type: "none" }) =>
    buildRequest({ request: { ...emptyRequest(), ...patch }, auth, vars, settings: DEFAULT_SETTINGS });
  const header = (headers: [string, string][], name: string) =>
    headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

  it("substitutes variables in the URL, path variables and headers", () => {
    const { spec } = build({
      url: "{{base}}/users/:userId?x={{id}}",
      pathVars: [kv("userId", "{{id}}")],
      headers: [kv("X-Token", "{{token}}"), kv("X-Off", "1", false), kv("", "ignored")],
    });
    expect(spec.url).toBe("https://api.test/users/5?x=5");
    expect(spec.method).toBe("GET");
    expect(header(spec.headers, "X-Token")).toBe("t0k");
    expect(header(spec.headers, "X-Off")).toBeUndefined();
    expect(header(spec.headers, "User-Agent")).toMatch(/^zman\//);
    expect(header(spec.headers, "Accept")).toBe("*/*");
    expect(spec.body).toEqual({ kind: "none" });
  });

  it("applies basic, bearer and API key auth", () => {
    expect(header(build({ url: "h" }, { type: "bearer", token: "{{token}}" }).spec.headers, "Authorization")).toBe(
      "Bearer t0k",
    );
    const basic = build({ url: "h" }, { type: "basic", username: "usér", password: "p:w" });
    expect(header(basic.spec.headers, "Authorization")).toBe(`Basic ${Buffer.from("usér:p:w").toString("base64")}`);
    const inHeader = build({ url: "h" }, { type: "apikey", key: "X-Key", value: "{{token}}", in: "header" });
    expect(header(inHeader.spec.headers, "X-Key")).toBe("t0k");
    const inQuery = build({ url: "h/p?a=1" }, { type: "apikey", key: "api key", value: "v&1", in: "query" });
    expect(inQuery.spec.url).toBe("http://h/p?a=1&api%20key=v%261");
  });

  it("lets an explicit header win over generated ones", () => {
    const { spec } = build(
      { url: "h", headers: [kv("authorization", "Custom abc"), kv("User-Agent", "mine")] },
      { type: "bearer", token: "x" },
    );
    expect(spec.headers.filter(([k]) => k.toLowerCase() === "authorization")).toEqual([["authorization", "Custom abc"]]);
    expect(header(spec.headers, "User-Agent")).toBe("mine");
  });

  it("warns about auth it cannot apply", () => {
    const { warnings } = build({ url: "h" }, { type: "unsupported", postmanType: "oauth2", raw: {} });
    expect(warnings[0]).toContain("oauth2");
  });

  it("builds raw bodies with a default content type", () => {
    const body = { ...emptyRequest().body, mode: "raw" as const, raw: '{"id": {{id}}}', rawLanguage: "json" as const };
    const { spec } = build({ url: "h", method: "post", body });
    expect(spec.method).toBe("POST");
    expect(spec.body).toEqual({ kind: "raw", text: '{"id": 5}' });
    expect(header(spec.headers, "Content-Type")).toBe("application/json");

    const custom = build({ url: "h", body, headers: [kv("Content-Type", "application/vnd.api+json")] });
    expect(custom.spec.headers.filter(([k]) => k.toLowerCase() === "content-type")).toHaveLength(1);
  });

  it("builds urlencoded and multipart bodies", () => {
    const urlencoded = build({
      url: "h",
      body: { ...emptyRequest().body, mode: "urlencoded", urlencoded: [kv("a", "{{id}}"), kv("b", "x", false)] },
    });
    expect(urlencoded.spec.body).toEqual({ kind: "urlencoded", fields: [["a", "5"]] });

    const multipart = build({
      url: "h",
      headers: [kv("Content-Type", "multipart/form-data")],
      body: {
        ...emptyRequest().body,
        mode: "formdata",
        formdata: [formPart("t", "{{id}}"), formPart("f", "/tmp/a.png", "file"), formPart("empty", "", "file")],
      },
    });
    expect(multipart.spec.body).toEqual({
      kind: "formdata",
      parts: [
        { kind: "text", name: "t", value: "5" },
        { kind: "file", name: "f", path: "/tmp/a.png" },
      ],
    });
    expect(header(multipart.spec.headers, "Content-Type")).toBeUndefined();
    expect(multipart.warnings).toHaveLength(1);
  });

  it("builds GraphQL bodies", () => {
    const body = { ...emptyRequest().body, mode: "graphql" as const, graphqlQuery: "{ me { id } }", graphqlVariables: '{"n": {{id}}}' };
    const { spec } = build({ url: "h", body });
    expect(spec.body.kind === "raw" && JSON.parse(spec.body.text)).toEqual({ query: "{ me { id } }", variables: { n: 5 } });

    const bad = build({ url: "h", body: { ...body, graphqlVariables: "{oops" } });
    expect(bad.warnings[0]).toMatch(/not valid JSON/);
  });

  it("throws on an unusable URL", () => {
    expect(() => build({ url: "" })).toThrow(/empty/);
  });
});

describe("effectiveAuth", () => {
  const collection = { ...newCollection("Col"), auth: { type: "bearer", token: "c" } as Auth };
  const outer = { ...newFolder("Outer"), auth: { type: "basic", username: "u", password: "p" } as Auth };
  const inner = newFolder("Inner");

  it("uses the request's own auth when set", () => {
    expect(effectiveAuth({ type: "none" }, [outer], collection)).toEqual({ auth: { type: "none" } });
  });

  it("inherits from the nearest folder, then the collection", () => {
    expect(effectiveAuth({ type: "inherit" }, [outer, inner], collection)).toEqual({ auth: outer.auth, inheritedFrom: "Outer" });
    expect(effectiveAuth({ type: "inherit" }, [inner], collection)).toEqual({ auth: collection.auth, inheritedFrom: "Col" });
    expect(effectiveAuth({ type: "inherit" }, [])).toEqual({ auth: { type: "none" } });
  });
});

describe("format", () => {
  it("pretty-prints JSON without touching number literals", () => {
    const text = '{"id":12345678901234567890,"price":1.10,"tags":["a","b"],"empty":{},"none":[ ],"s":"x:{,}\\"y"}';
    expect(prettyJson(text)).toBe(
      [
        "{",
        '  "id": 12345678901234567890,',
        '  "price": 1.10,',
        '  "tags": [',
        '    "a",',
        '    "b"',
        "  ],",
        '  "empty": {},',
        '  "none": [],',
        '  "s": "x:{,}\\"y"',
        "}",
      ].join("\n"),
    );
    expect(prettyJson("not json")).toBeNull();
    expect(prettyJson(' [1, 2] ')).toBe("[\n  1,\n  2\n]");
  });

  it("formats sizes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatDuration(87)).toBe("87 ms");
    expect(formatDuration(1234)).toBe("1.23 s");
  });

  it("classifies content types", () => {
    expect(contentKind("application/json; charset=utf-8", true)).toBe("json");
    expect(contentKind("application/problem+json", true)).toBe("json");
    expect(contentKind("text/html", true)).toBe("html");
    expect(contentKind("image/png", false)).toBe("image");
    expect(contentKind("image/svg+xml", true)).toBe("xml");
    expect(contentKind("application/octet-stream", false)).toBe("binary");
    expect(contentKind(undefined, true)).toBe("text");
  });

  it("parses Set-Cookie headers", () => {
    expect(
      parseSetCookies([
        ["content-type", "text/plain"],
        ["set-cookie", "sid=abc=123; Path=/; HttpOnly; Max-Age=3600"],
        ["Set-Cookie", "theme=dark"],
      ]),
    ).toEqual([
      { name: "sid", value: "abc=123", attributes: { path: "/", httponly: "true", "max-age": "3600" } },
      { name: "theme", value: "dark", attributes: {} },
    ]);
  });
});
