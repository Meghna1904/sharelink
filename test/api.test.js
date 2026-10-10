import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "../src/app.js";

describe("ShareLink API", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createServer({
      dbPath: ":memory:",
      codeSecret: "test-secret",
      titleFetcher: async () => "Fetched title"
    });
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("logs partners into the same space with a shared code", async () => {
    const whiskey = await request("/api/session", {
      method: "POST",
      body: { name: "Whiskey", code: "0101" },
      auth: false
    });
    const matilda = await request("/api/session", {
      method: "POST",
      body: { name: "Matilda", code: "0101" },
      auth: false
    });

    assert.equal(whiskey.status, 200);
    assert.equal(matilda.status, 200);
    assert.equal(whiskey.body.partnerName, "Whiskey");
    assert.equal(matilda.body.partnerName, "Matilda");
  });

  it("adds and lists links for both partners in one couple", async () => {
    const created = await request("/api/links", {
      method: "POST",
      name: "Whiskey",
      code: "0101",
      body: {
        url: "https://example.com/thing",
        title: "A good thing",
        note: "Maybe for the kitchen."
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.link.saverName, "Whiskey");

    const listed = await request("/api/links", {
      name: "Matilda",
      code: "0101"
    });

    assert.equal(listed.status, 200);
    assert.equal(listed.body.links.length, 1);
    assert.equal(listed.body.links[0].title, "A good thing");
    assert.equal(listed.body.links[0].note, "Maybe for the kitchen.");
  });

  it("edits and deletes only the link saved by the current partner", async () => {
    const created = await request("/api/links", {
      method: "POST",
      name: "Matilda",
      code: "0101",
      body: {
        url: "https://example.com/book",
        title: "Book",
        note: ""
      }
    });
    const id = created.body.link.id;

    const denied = await request(`/api/links/${id}`, {
      method: "PATCH",
      name: "Whiskey",
      code: "0101",
      body: { title: "Different book" }
    });
    assert.equal(denied.status, 403);

    const edited = await request(`/api/links/${id}`, {
      method: "PATCH",
      name: "Matilda",
      code: "0101",
      body: { title: "Gift book", note: "Hardcover" }
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.link.title, "Gift book");
    assert.equal(edited.body.link.note, "Hardcover");

    const deleted = await request(`/api/links/${id}`, {
      method: "DELETE",
      name: "Matilda",
      code: "0101"
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);

    const listed = await request("/api/links", {
      name: "Matilda",
      code: "0101"
    });
    assert.equal(listed.body.links.some((link) => link.id === id), false);
  });

  it("rejects malformed URLs", async () => {
    const response = await request("/api/links", {
      method: "POST",
      name: "Whiskey",
      code: "0101",
      body: { url: "not-a-url" }
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /valid http or https URL/);
  });

  async function request(path, options = {}) {
    const headers = { "content-type": "application/json" };
    if (options.auth !== false) {
      headers["x-partner-name"] = options.name ?? "Whiskey";
      headers["x-couple-code"] = options.code ?? "0101";
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    return {
      status: response.status,
      body: await response.json()
    };
  }
});
