import assert from "node:assert/strict";
import { test, before } from "node:test";

const API = process.env.API_URL || "http://127.0.0.1:8787";
const TOKEN = process.env.MODERATOR_TOKEN || "";

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not start at ${API}`);
}

async function send(body) {
  const response = await fetch(`${API}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4173" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data, headers: response.headers };
}

async function board() {
  const response = await fetch(`${API}/`, { cache: "no-store" });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  return response.json();
}

before(async () => {
  await waitForHealth();
});

test("preflight allows a JSON post", async () => {
  const response = await fetch(`${API}/`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:4173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-headers"), /content-type/i);
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
});

test("a price keeps county, tank, and date, and a second read sees it", async () => {
  const deviceId = "deviceprice0001";
  const date = daysAgo(10);
  const posted = await send({
    kind: "price",
    deviceId,
    supplier: "IntTest Supplier",
    county: "antrim",
    town: "Example",
    price: "2.00",
    priceType: "locked-in",
    tank: "leased",
    date,
    fees: ["sales tax", "delivery/service"],
    handle: "John Smith",
    hp: "",
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  assert.equal(posted.data.ok, true);
  const live = await board();
  const saved = live.prices.find((item) => item.id === posted.data.id);
  assert.ok(saved);
  assert.equal(saved.supplier, "IntTest Supplier");
  assert.equal(saved.county, "Antrim");
  assert.equal(saved.town, "Example");
  assert.equal(Number(saved.price), 2);
  assert.equal(saved.type, "locked-in");
  assert.equal(saved.tank, "leased");
  assert.equal(saved.date, date);
  assert.deepEqual(saved.fees, ["sales tax", "delivery/service"]);
  assert.equal(saved.handle, "Anonymous");
  assert.equal(saved.timestamp.slice(0, 10) === date, false);
  assert.equal(JSON.stringify(saved).includes(deviceId), false);
  assert.equal(Object.keys(saved).some((key) => key.toLowerCase().includes("vote")), false);
});

test("phone numbers, street addresses, and the honeypot do not land on the board", async () => {
  const before = await board();
  const phone = await send({
    kind: "price",
    deviceId: "devicephone0001",
    supplier: "Call 231-555-0199",
    county: "Antrim",
    town: "Example",
    price: "2.10",
    priceType: "will-call",
    tank: "owned",
    date: daysAgo(3),
    fees: [],
    handle: "Blue Regulator 482",
  });
  assert.equal(phone.status, 400);
  const street = await send({
    kind: "discuss",
    deviceId: "devicestreet001",
    title: "Where",
    body: "The tank is at 12 Oak Lane",
    category: "delivery",
    handle: "Blue Regulator 482",
  });
  assert.equal(street.status, 400);
  const bot = await send({
    kind: "price",
    deviceId: "devicehoneypot1",
    supplier: "Honeypot Supplier",
    county: "Antrim",
    town: "Example",
    price: "3.00",
    priceType: "budget",
    tank: "owned",
    date: daysAgo(3),
    fees: [],
    handle: "Blue Regulator 482",
    hp: "https://spam.example",
  });
  assert.equal(bot.status, 200);
  assert.equal(bot.data.ok, true);
  const after = await board();
  const blob = JSON.stringify(after);
  assert.equal(blob.includes("231-555-0199"), false);
  assert.equal(blob.includes("12 Oak Lane"), false);
  assert.equal(blob.includes("Honeypot Supplier"), false);
  assert.equal(after.prices.length, before.prices.length);
});

test("three different reports hide a post and a repeat report does not", async () => {
  const posted = await send({
    kind: "price",
    deviceId: "devicereportsrc1",
    supplier: "Report Target",
    county: "Emmet",
    town: "Example",
    price: "3.25",
    priceType: "will-call",
    tank: "owned",
    date: daysAgo(4),
    fees: [],
    handle: "Pine Gauge 111",
  });
  assert.equal(posted.data.ok, true);
  const first = await send({ kind: "report", deviceId: "reporterdevice1", id: posted.data.id });
  const again = await send({ kind: "report", deviceId: "reporterdevice1", id: posted.data.id });
  assert.equal(again.data.duplicate, true);
  let visible = await board();
  assert.ok(visible.prices.some((item) => item.id === posted.data.id));
  assert.equal(first.data.ok, true);
  await send({ kind: "report", deviceId: "reporterdevice2", id: posted.data.id });
  await send({ kind: "report", deviceId: "reporterdevice3", id: posted.data.id });
  visible = await board();
  assert.equal(visible.prices.some((item) => item.id === posted.data.id), false);
});

test("the sixth post in an hour is refused", async () => {
  const deviceId = "ratelimitdevice1";
  for (let i = 0; i < 5; i += 1) {
    const posted = await send({
      kind: "discuss",
      deviceId,
      title: `Note ${i}`,
      body: "A short anonymous note about fees.",
      category: "fees",
      handle: "Lake Valve 222",
    });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
  }
  const blocked = await send({
    kind: "discuss",
    deviceId,
    title: "One more",
    body: "This one should be limited.",
    category: "fees",
    handle: "Lake Valve 222",
  });
  assert.equal(blocked.status, 429);
  const live = await board();
  assert.equal(live.discussions.some((item) => item.title === "One more"), false);
  const note = live.discussions.find((item) => item.title === "Note 0");
  assert.equal(note.category, "fees");
  assert.equal(Object.keys(note).some((key) => key.toLowerCase().includes("vote")), false);
});

test("a moderator token can hide a post and a wrong token cannot", async () => {
  assert.ok(TOKEN, "MODERATOR_TOKEN is required for this check");
  const posted = await send({
    kind: "discuss",
    deviceId: "devicehide00001",
    title: "Hide me",
    body: "This note should leave the board.",
    category: "rants",
    handle: "Red Burner 333",
  });
  const wrong = await send({ kind: "hide", id: posted.data.id, token: "not-the-token" });
  assert.equal(wrong.status, 404);
  const hidden = await send({ kind: "hide", id: posted.data.id, token: TOKEN });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.ok, true);
  const live = await board();
  assert.equal(live.discussions.some((item) => item.id === posted.data.id), false);
});
