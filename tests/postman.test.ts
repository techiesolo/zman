import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportCollection, exportEnvironment, exportUrl } from "../src/lib/postman/export";
import { ImportError, importPostmanJson, type CollectionImport } from "../src/lib/postman/import";
import { locate } from "../src/lib/tree";
import type { Collection, FolderItem, Item, RequestItem } from "../src/model/types";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function importCollection(name: string): CollectionImport {
  const result = importPostmanJson(fixture(name));
  if (result.kind !== "collection") throw new Error("expected a collection");
  return result;
}

function byName(items: Item[], name: string): Item {
  const item = items.find((i) => i.name === name);
  if (!item) throw new Error(`no item named ${name}`);
  return item;
}
const folder = (items: Item[], name: string) => byName(items, name) as FolderItem;
const request = (items: Item[], name: string) => (byName(items, name) as RequestItem).request;

/** Ids are generated on import, so comparisons have to ignore them. */
function stripIds<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === "id" ? undefined : v))) as T;
}

describe("Postman v2.1 import", () => {
  const { collection, stats, warnings } = importCollection("shop-api.postman_collection.json");

  it("reads collection metadata, variables and auth", () => {
    expect(collection.name).toBe("Shop API");
    expect(collection.description).toBe("Sample collection exported from Postman.");
    expect(collection.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(collection.variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
      ["baseUrl", "https://api.example.com/v1", true],
      ["pageSize", "20", true],
      ["legacy", "x", false],
    ]);
  });

  it("keeps the folder structure", () => {
    expect(stats).toEqual({ requests: 8, folders: 3 });
    expect(collection.items.map((i) => [i.type, i.name])).toEqual([
      ["folder", "Auth"],
      ["folder", "Products"],
      ["request", "GraphQL search"],
      ["request", "Health"],
    ]);
    const products = folder(collection.items, "Products");
    expect(folder(products.items, "Admin").items).toHaveLength(1);
    expect(folder(collection.items, "Auth").auth).toEqual({ type: "none" });
    expect(products.auth).toEqual({ type: "inherit" });
  });

  it("reads a raw JSON body with its language", () => {
    const login = request(folder(collection.items, "Auth").items, "Login");
    expect(login.method).toBe("POST");
    expect(login.url).toBe("{{baseUrl}}/auth/login");
    expect(login.body.mode).toBe("raw");
    expect(login.body.rawLanguage).toBe("json");
    expect(login.body.raw).toContain('"email": "{{email}}"');
    expect(login.auth).toEqual({ type: "none" });
  });

  it("reads query params including disabled ones and descriptions", () => {
    const list = request(folder(collection.items, "Products").items, "List products");
    expect(list.url).toBe("{{baseUrl}}/products?page=1&limit={{pageSize}}");
    expect(list.params.map((p) => [p.key, p.value, p.enabled, p.description])).toEqual([
      ["page", "1", true, undefined],
      ["limit", "{{pageSize}}", true, "Items per page"],
      ["sort", "price", false, undefined],
    ]);
    expect(list.headers.map((h) => [h.key, h.enabled])).toEqual([
      ["Accept", true],
      ["X-Debug", false],
    ]);
    expect(list.auth).toEqual({ type: "inherit" });
  });

  it("reads path variables", () => {
    const get = request(folder(collection.items, "Products").items, "Get product");
    expect(get.pathVars.map((v) => [v.key, v.value, v.description])).toEqual([["productId", "42", "Product id"]]);
  });

  it("reads form bodies and auth types", () => {
    const token = request(folder(collection.items, "Auth").items, "Token (form)");
    expect(token.auth).toEqual({ type: "basic", username: "client", password: "s3cret" });
    expect(token.body.mode).toBe("urlencoded");
    expect(token.body.urlencoded.map((f) => [f.key, f.value, f.enabled])).toEqual([
      ["grant_type", "client_credentials", true],
      ["scope", "read write", false],
    ]);

    const upload = request(folder(collection.items, "Products").items, "Upload image");
    expect(upload.auth).toEqual({ type: "apikey", key: "X-API-Key", value: "{{apiKey}}", in: "header" });
    expect(upload.body.mode).toBe("formdata");
    expect(upload.body.formdata.map((p) => [p.key, p.type, p.value])).toEqual([
      ["title", "text", "Front view"],
      ["image", "file", "/home/me/pictures/front.png"],
    ]);
  });

  it("reads GraphQL bodies and bare URL requests", () => {
    const gql = request(collection.items, "GraphQL search");
    expect(gql.body.mode).toBe("graphql");
    expect(gql.body.graphqlQuery).toContain("query Search");
    expect(JSON.parse(gql.body.graphqlVariables)).toEqual({ q: "shoes" });

    const health = request(collection.items, "Health");
    expect(health.method).toBe("GET");
    expect(health.url).toBe("https://status.example.com/health");
  });

  it("keeps what it cannot interpret and says so", () => {
    const login = byName(folder(collection.items, "Auth").items, "Login") as RequestItem;
    expect(login.postman?.event).toBeDefined();
    expect(login.postman?.response).toHaveLength(1);
    expect(login.description).toBe("Returns a JWT.");

    const admin = folder(folder(collection.items, "Products").items, "Admin");
    const del = request(admin.items, "Delete product");
    expect(del.auth.type).toBe("unsupported");

    expect(warnings).toHaveLength(4);
    // The collection-level script is empty, so only Login counts.
    expect(warnings[0]).toMatch(/^1 item has pre-request or test scripts/);
    expect(warnings[1]).toContain("oauth2");
    expect(warnings[2]).toMatch(/^1 request body refers to files/);
    expect(warnings[3]).toMatch(/^1 saved example response is kept/);
  });

  it("gives every item a unique id", () => {
    const ids = new Set<string>();
    const visit = (items: Item[]) => {
      for (const item of items) {
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
        if (item.type === "folder") visit(item.items);
      }
    };
    visit(collection.items);
    expect(ids.size).toBe(11);
    expect(locate(collection, [...ids][5]!)).not.toBeNull();
  });
});

describe("Postman v2.0 import", () => {
  const { collection } = importCollection("legacy.postman_collection_v2.0.json");

  it("handles string URLs, string headers and object-style auth", () => {
    const create = request(collection.items, "Create user");
    expect(create.method).toBe("POST");
    expect(create.url).toBe("http://localhost:8080/users?notify=true");
    expect(create.params.map((p) => [p.key, p.value])).toEqual([["notify", "true"]]);
    expect(create.headers.map((h) => [h.key, h.value])).toEqual([
      ["Content-Type", "application/xml"],
      ["X-Trace", "1"],
    ]);
    expect(create.auth).toEqual({ type: "basic", username: "admin", password: "hunter2" });
    expect(create.body.rawLanguage).toBe("xml");
    expect((byName(collection.items, "Create user") as RequestItem).description).toBe("Creates a user.");
  });

  it("assembles a URL that has no raw field", () => {
    const upload = request(collection.items, "Upload");
    expect(upload.url).toBe("http://localhost:8080/files/1?overwrite=true");
    expect(upload.params.map((p) => [p.key, p.enabled])).toEqual([
      ["overwrite", true],
      ["dry", false],
    ]);
    expect(upload.body.mode).toBe("binary");
    expect(upload.body.binaryPath).toBe("/tmp/payload.bin");
  });

  it("treats a missing collection auth as no auth", () => {
    expect(collection.auth).toEqual({ type: "none" });
  });
});

describe("Postman export", () => {
  const { collection } = importCollection("shop-api.postman_collection.json");
  const exported = exportCollection(collection) as {
    info: Record<string, string>;
    item: Record<string, any>[];
    auth: unknown;
    variable: unknown[];
  };

  it("writes a v2.1 document", () => {
    expect(exported.info.schema).toBe("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
    expect(exported.info.name).toBe("Shop API");
    expect(exported.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
    expect(exported.variable).toHaveLength(3);
  });

  it("splits URLs into the parts Postman reads", () => {
    const list = exported.item[1]!.item[0].request;
    expect(list.url).toEqual({
      raw: "{{baseUrl}}/products?page=1&limit={{pageSize}}",
      host: ["{{baseUrl}}"],
      path: ["products"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "{{pageSize}}", description: "Items per page" },
        { key: "sort", value: "price", disabled: true },
      ],
    });
    const token = exported.item[0]!.item[1].request;
    expect(token.url).toEqual({
      raw: "https://auth.example.com:8443/oauth/token",
      protocol: "https",
      host: ["auth", "example", "com"],
      port: "8443",
      path: ["oauth", "token"],
    });
  });

  it("writes back scripts, examples and unsupported auth untouched", () => {
    const source = JSON.parse(fixture("shop-api.postman_collection.json"));
    const login = exported.item[0]!.item[0];
    expect(login.event).toEqual(source.item[0].item[0].event);
    expect(login.response).toEqual(source.item[0].item[0].response);
    const del = exported.item[1]!.item[3].item[0].request;
    expect(del.auth).toEqual(source.item[1].item[3].item[0].request.auth);
  });

  it("round-trips: importing its own export gives the same collection", () => {
    for (const name of ["shop-api.postman_collection.json", "legacy.postman_collection_v2.0.json"]) {
      const first = importCollection(name).collection;
      const again = importPostmanJson(JSON.stringify(exportCollection(first)));
      expect(again.kind).toBe("collection");
      expect(stripIds((again as CollectionImport).collection)).toEqual(stripIds<Collection>(first));
    }
  });

  it("does not split hosts or paths inside a variable", () => {
    const url = exportUrl({ url: "https://{{api.host}}:{{port}}/a/{{b/c}}/", params: [], pathVars: [] });
    expect(url).toEqual({
      raw: "https://{{api.host}}:{{port}}/a/{{b/c}}/",
      protocol: "https",
      host: ["{{api.host}}"],
      port: "{{port}}",
      path: ["a", "{{b/c}}", ""],
    });
  });
});

describe("Postman environments", () => {
  it("imports an environment file", () => {
    const result = importPostmanJson(fixture("staging.postman_environment.json"));
    if (result.kind !== "environment") throw new Error("expected an environment");
    expect(result.scope).toBe("environment");
    expect(result.environment.name).toBe("Staging");
    expect(result.environment.variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
      ["baseUrl", "https://staging.example.com/v1", true],
      ["token", "", true],
      ["pageSize", "50", false],
    ]);
  });

  it("round-trips through export", () => {
    const first = importPostmanJson(fixture("staging.postman_environment.json"));
    if (first.kind !== "environment") throw new Error("expected an environment");
    const again = importPostmanJson(JSON.stringify(exportEnvironment(first.environment)));
    if (again.kind !== "environment") throw new Error("expected an environment");
    expect(stripIds(again.environment)).toEqual(stripIds(first.environment));
  });

  it("recognises a globals file", () => {
    const result = importPostmanJson(
      JSON.stringify({ name: "Globals", values: [{ key: "g", value: "1", enabled: true }], _postman_variable_scope: "globals" }),
    );
    expect(result.kind === "environment" && result.scope).toBe("globals");
  });
});

describe("import errors", () => {
  it.each([
    ["not json at all", /not valid JSON/],
    ["[1,2,3]", /not a Postman collection/],
    ['{"hello":"world"}', /not a Postman collection/],
    ['{"requests":[],"order":[]}', /Collection v1/],
    ['{"openapi":"3.0.0","paths":{}}', /OpenAPI/],
    ['{"collections":[],"environments":[]}', /data dump/],
  ])("rejects %s", (text, message) => {
    expect(() => importPostmanJson(text)).toThrow(ImportError);
    expect(() => importPostmanJson(text)).toThrow(message);
  });
});
