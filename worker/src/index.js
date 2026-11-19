// Public board API.
// OPTIONS is answered so a browser JSON post can send Content-Type: application/json.
// IP addresses are not stored. The browser's random id is hashed before it is saved.

import {
  LIMITS,
  InputError,
  validatePrice,
  validateDiscussion,
  cleanDeviceId,
  honeypotTripped,
  isUuid,
} from "../../shared/rules.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS prices (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    supplier TEXT NOT NULL,
    county TEXT NOT NULL,
    town TEXT NOT NULL,
    price_per_gal REAL NOT NULL,
    price_type TEXT NOT NULL,
    tank TEXT NOT NULL,
    price_date TEXT NOT NULL,
    fees TEXT NOT NULL,
    handle TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    report_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS discussions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL,
    handle TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    report_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    post_id TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, device_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prices_live ON prices (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_discuss_live ON discussions (status, created_at)`,
];

let schemaReady = null;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function isInput(err) {
  return Boolean(err && (err.name === "InputError" || err instanceof InputError));
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenMatches(given, expected) {
  const encoder = new TextEncoder();
  const left = encoder.encode(String(given ?? ""));
  const right = encoder.encode(String(expected ?? ""));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

async function rateLimit(env, bucket, max) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - windowMs).run();
  const existing = await env.DB.prepare("SELECT count FROM rate_limits WHERE bucket = ?").bind(bucket).first();
  if (!existing) {
    await env.DB.prepare("INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)")
      .bind(bucket, now)
      .run();
    return true;
  }
  if (Number(existing.count) >= max) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").bind(bucket).run();
  return true;
}

function parseFees(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw new InputError("That post is too large.");
  const text = await request.text();
  if (text.length > 20000) throw new InputError("That post is too large.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new InputError("Bad request");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new InputError("Bad request");
  return data;
}

async function board(env) {
  const prices = await env.DB.prepare(
    `SELECT id, created_at, supplier, county, town, price_per_gal, price_type, tank, price_date, fees, handle
     FROM prices WHERE status = 'live' ORDER BY created_at DESC LIMIT 200`
  ).all();
  const discussions = await env.DB.prepare(
    `SELECT id, created_at, title, body, category, handle
     FROM discussions WHERE status = 'live' ORDER BY created_at DESC LIMIT 200`
  ).all();
  return {
    prices: (prices.results || []).map((row) => ({
      id: row.id,
      supplier: row.supplier,
      county: row.county,
      town: row.town,
      price: row.price_per_gal,
      type: row.price_type,
      tank: row.tank,
      date: row.price_date,
      fees: parseFees(row.fees),
      handle: row.handle,
      timestamp: row.created_at,
    })),
    discussions: (discussions.results || []).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      category: row.category,
      handle: row.handle,
      timestamp: row.created_at,
    })),
  };
}

async function createPrice(env, data) {
  const price = validatePrice(data);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO prices (
      id, created_at, supplier, county, town, price_per_gal, price_type, tank, price_date, fees, handle, status, report_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 0)`
  )
    .bind(
      id,
      new Date().toISOString(),
      price.supplier,
      price.county,
      price.town,
      price.price,
      price.priceType,
      price.tank,
      price.date,
      JSON.stringify(price.fees),
      price.handle
    )
    .run();
  return { ok: true, id };
}

async function createDiscussion(env, data) {
  const post = validateDiscussion(data);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO discussions (
      id, created_at, title, body, category, handle, status, report_count
    ) VALUES (?, ?, ?, ?, ?, ?, 'live', 0)`
  )
    .bind(id, new Date().toISOString(), post.title, post.body, post.category, post.handle)
    .run();
  return { ok: true, id };
}

async function report(env, data, deviceHash) {
  const id = String(data.id ?? "").trim().toLowerCase();
  if (!isUuid(id)) return { ok: false, error: "Post not found", status: 404 };
  const price = await env.DB.prepare("SELECT id, status FROM prices WHERE id = ?").bind(id).first();
  const discussion = price
    ? null
    : await env.DB.prepare("SELECT id, status FROM discussions WHERE id = ?").bind(id).first();
  const row = price || discussion;
  if (!row || row.status !== "live") return { ok: false, error: "Post not found", status: 404 };
  try {
    await env.DB.prepare("INSERT INTO reports (post_id, device_hash, created_at) VALUES (?, ?, ?)")
      .bind(id, deviceHash, new Date().toISOString())
      .run();
  } catch (err) {
    if (String(err?.message || err).toLowerCase().includes("unique")) {
      return { ok: true, duplicate: true };
    }
    throw err;
  }
  const counted = await env.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE post_id = ?").bind(id).first();
  const count = Number(counted?.c || 0);
  const status = count >= LIMITS.reportsToHide ? "hidden" : "live";
  const update = price
    ? "UPDATE prices SET report_count = ?, status = ? WHERE id = ?"
    : "UPDATE discussions SET report_count = ?, status = ? WHERE id = ?";
  await env.DB.prepare(update).bind(count, status, id).run();
  return { ok: true };
}

async function hide(env, data) {
  if (!env.MODERATOR_TOKEN) return json({ ok: false, error: "Not found" }, 404);
  if (!(await rateLimit(env, "hide:global", 30))) {
    return json({ ok: false, error: "Too many requests." }, 429);
  }
  if (!(await tokenMatches(data.token, env.MODERATOR_TOKEN))) {
    return json({ ok: false, error: "Not found" }, 404);
  }
  const id = String(data.id ?? "").trim().toLowerCase();
  if (!isUuid(id)) return json({ ok: false, error: "Post not found" }, 404);
  await env.DB.prepare("UPDATE prices SET status = 'hidden' WHERE id = ?").bind(id).run();
  await env.DB.prepare("UPDATE discussions SET status = 'hidden' WHERE id = ?").bind(id).run();
  const price = await env.DB.prepare("SELECT status FROM prices WHERE id = ?").bind(id).first();
  const discussion = await env.DB.prepare("SELECT status FROM discussions WHERE id = ?").bind(id).first();
  const row = price || discussion;
  if (row && row.status === "hidden") return json({ ok: true });
  return json({ ok: false, error: "Post not found" }, 404);
}

function payload(result) {
  const body = { ok: Boolean(result.ok) };
  if (result.id) body.id = result.id;
  if (result.error) body.error = result.error;
  if (result.duplicate) body.duplicate = true;
  return json(body, result.status || (result.ok ? 200 : 400));
}

async function post(request, env) {
  let data;
  try {
    data = await readJson(request);
  } catch (err) {
    if (isInput(err)) return json({ ok: false, error: err.message }, 400);
    throw err;
  }
  try {
    if (data.kind === "hide") return hide(env, data);
    const deviceId = cleanDeviceId(data.deviceId);
    if (!deviceId) return json({ ok: false, error: "Please refresh the page and try again." }, 400);
    const deviceHash = await sha256(deviceId);
    if (data.kind === "report") {
      if (!(await rateLimit(env, `report:${deviceHash}`, LIMITS.reportsPerHour))) {
        return json({ ok: false, error: "Too many reports. Try again later." }, 429);
      }
      if (honeypotTripped(data)) return json({ ok: true });
      return payload(await report(env, data, deviceHash));
    }
    if (data.kind === "price" || data.kind === "discuss") {
      if (!(await rateLimit(env, `post:${deviceHash}`, LIMITS.postsPerHour))) {
        return json({ ok: false, error: "Too many posts. Try again later." }, 429);
      }
      if (honeypotTripped(data)) return json({ ok: true });
      if (data.kind === "price") return payload(await createPrice(env, data));
      return payload(await createDiscussion(env, data));
    }
    return json({ ok: false, error: "Unknown request." }, 400);
  } catch (err) {
    if (isInput(err)) return json({ ok: false, error: err.message }, 400);
    throw err;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    try {
      if (!env.DB) return json({ ok: false, error: "Server is missing its database." }, 500);
      await ensureSchema(env);
      const url = new URL(request.url);
      const boardPath = url.pathname === "/" || url.pathname === "/api/board";
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
      if (request.method === "GET" && boardPath) return json(await board(env));
      if (request.method === "POST" && boardPath) return await post(request, env);
      return json({ ok: false, error: "Not found" }, 404);
    } catch (err) {
      console.error(err && err.message ? err.message : "request failed");
      return json({ ok: false, error: "Something went wrong." }, 500);
    }
  },
};
