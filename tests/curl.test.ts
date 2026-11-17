import { describe, expect, it } from "vitest";
import { buildRequest } from "../src/lib/buildRequest";
import { generateCurl, shellQuote } from "../src/lib/curl/generate";
import { CurlParseError, looksLikeCurl, parseCurl, tokenize } from "../src/lib/curl/parse";
import { DEFAULT_SETTINGS, type RequestDef } from "../src/model/types";

const headers = (r: RequestDef) => r.headers.map((h) => [h.key, h.value]);

describe("tokenize", () => {
  it("handles quotes, escapes and line continuations", () => {
    expect(tokenize(`curl 'a b' "c \\"d\\" $x" e\\ f \\\n  --flag ''`)).toEqual([
      "curl",
      "a b",
      'c "d" $x',
      "e f",
      "--flag",
      "",
    ]);
  });

  it("handles ANSI-C quoting", () => {
    expect(tokenize(String.raw`$'line1\nline2\t\'q\' \x41é'`)).toEqual(["line1\nline2\t'q' Aé"]);
  });

  it("joins adjacent quoted pieces", () => {
    expect(tokenize(`a'b'"c"`)).toEqual(["abc"]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => tokenize("curl 'oops")).toThrow(CurlParseError);
  });
});

describe("parseCurl", () => {
  it("parses a simple GET", () => {
    const { request, warnings } = parseCurl("curl https://api.example.com/users?page=2&q=a%20b");
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://api.example.com/users?page=2&q=a%20b");
    expect(request.params.map((p) => [p.key, p.value])).toEqual([
      ["page", "2"],
      ["q", "a%20b"],
    ]);
    expect(request.body.mode).toBe("none");
    expect(warnings).toEqual([]);
  });

  it("parses a JSON POST as copied from browser devtools", () => {
    const { request } = parseCurl(`curl 'https://api.example.com/login' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  -b 'sid=abc; theme=dark' \\
  --data-raw '{"email":"a@b.c","note":"it'\\''s"}' \\
  --compressed`);
    expect(request.method).toBe("POST");
    expect(headers(request)).toEqual([
      ["accept", "application/json"],
      ["content-type", "application/json"],
      ["Cookie", "sid=abc; theme=dark"],
    ]);
    expect(request.body.mode).toBe("raw");
    expect(request.body.rawLanguage).toBe("json");
    expect(JSON.parse(request.body.raw)).toEqual({ email: "a@b.c", note: "it's" });
  });

  it("treats -d without a content type as a form", () => {
    const { request } = parseCurl("curl -X PUT -d 'name=Ann+Lee' -d 'city=H%C3%A0%20N%E1%BB%99i' http://h/users/1");
    expect(request.method).toBe("PUT");
    expect(request.body.mode).toBe("urlencoded");
    expect(request.body.urlencoded.map((f) => [f.key, f.value])).toEqual([
      ["name", "Ann Lee"],
      ["city", "Hà Nội"],
    ]);
  });

  it("keeps curl's default content type when -d carries JSON", () => {
    const { request } = parseCurl(`curl http://h/x -d '{"a":1}'`);
    expect(request.body.mode).toBe("raw");
    expect(request.body.rawLanguage).toBe("json");
    expect(headers(request)).toEqual([["Content-Type", "application/x-www-form-urlencoded"]]);
  });

  it("supports --json", () => {
    const { request } = parseCurl(`curl --json '{"a":1}' http://h/x`);
    expect(request.method).toBe("POST");
    expect(request.body.rawLanguage).toBe("json");
    expect(headers(request)).toEqual([
      ["Content-Type", "application/json"],
      ["Accept", "application/json"],
    ]);
  });

  it("parses multipart forms", () => {
    const { request } = parseCurl(`curl -F 'title=Hi there' -F 'file=@"/tmp/a b.png";type=image/png' -F note=x\;y http://h/up`);
    expect(request.method).toBe("POST");
    expect(request.body.mode).toBe("formdata");
    expect(request.body.formdata.map((p) => [p.key, p.type, p.value])).toEqual([
      ["title", "text", "Hi there"],
      ["file", "file", "/tmp/a b.png"],
      ["note", "text", "x;y"],
    ]);
  });

  it("parses auth, bundled short flags and attached values", () => {
    const { request, warnings } = parseCurl("curl -sSLk -XDELETE -u 'ann:p:w' -A agent/1 -e http://ref http://h/x -o out.txt");
    expect(request.method).toBe("DELETE");
    expect(request.auth).toEqual({ type: "basic", username: "ann", password: "p:w" });
    expect(headers(request)).toEqual([
      ["User-Agent", "agent/1"],
      ["Referer", "http://ref"],
    ]);
    expect(warnings).toEqual(["Ignored options: -o."]);
  });

  it("supports -G, -I, --url and --data-urlencode", () => {
    const get = parseCurl("curl -G --data-urlencode 'q=a b&c' -d page=2 --url 'http://h/s?x=1'").request;
    expect(get.method).toBe("GET");
    expect(get.url).toBe("http://h/s?x=1&q=a%20b%26c&page=2");
    expect(get.body.mode).toBe("none");
    expect(parseCurl("curl -I http://h").request.method).toBe("HEAD");
  });

  it("reads a body from a file reference", () => {
    const { request, warnings } = parseCurl("curl --data-binary @/tmp/payload.bin -H 'Content-Type: application/octet-stream' http://h/up");
    expect(request.body.mode).toBe("binary");
    expect(request.body.binaryPath).toBe("/tmp/payload.bin");
    expect(warnings[0]).toContain("/tmp/payload.bin");
  });

  it("reports unknown options instead of failing", () => {
    expect(parseCurl("curl --some-new-flag http://h").warnings).toEqual(["Ignored options: --some-new-flag."]);
  });

  it("rejects things that are not curl commands", () => {
    expect(() => parseCurl("wget http://h")).toThrow(/start with "curl"/);
    expect(() => parseCurl("curl -H 'a: b'")).toThrow(/no URL/);
    expect(() => parseCurl("curl http://h -H")).toThrow(/needs a value/);
  });

  it("detects curl commands", () => {
    expect(looksLikeCurl("  curl http://h")).toBe(true);
    expect(looksLikeCurl("$ curl -X POST http://h")).toBe(true);
    expect(looksLikeCurl('{"info":{}}')).toBe(false);
    expect(looksLikeCurl("curly braces")).toBe(false);
  });
});

describe("generateCurl", () => {
  const spec = (request: RequestDef, settings = DEFAULT_SETTINGS) =>
    buildRequest({ request, auth: request.auth, vars: new Map(), settings }).spec;

  it("quotes for the shell", () => {
    expect(shellQuote("plain-1.2/x")).toBe("plain-1.2/x");
    expect(shellQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`);
    expect(shellQuote("")).toBe("''");
  });

  it("renders a GET without the headers zman adds itself", () => {
    const { request } = parseCurl("curl 'http://h/a?x=1&y=2' -H 'X-A: 1'");
    expect(generateCurl(spec(request))).toBe("curl -L 'http://h/a?x=1&y=2' \\\n  -H 'X-A: 1'");
  });

  it("honours redirect and TLS settings", () => {
    const { request } = parseCurl("curl http://h/");
    const settings = { ...DEFAULT_SETTINGS, followRedirects: false, verifySsl: false };
    expect(generateCurl(spec(request, settings))).toBe("curl -k http://h/");
  });

  it.each([
    `curl -X POST http://h/login -H 'Content-Type: application/json' --data-raw '{"a":"it'\\''s"}'`,
    "curl -X PUT http://h/u -d 'name=Ann+Lee' -d 'x=1%262'",
    "curl http://h/up -F 'title=a;b' -F 'file=@/tmp/a b.png'",
    "curl -u ann:secret http://h/private",
    "curl -X PATCH --data-binary @/tmp/p.bin -H 'Content-Type: application/x-thing' http://h/b",
    "curl -I http://h/head",
  ])("round-trips %s", (command) => {
    const first = spec(parseCurl(command).request);
    const second = spec(parseCurl(generateCurl(first)).request);
    expect(second).toEqual(first);
  });
});
