import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "node:test";
import {
  LIMITS,
  cleanHandle,
  containsBlockedContact,
  groupPrices,
  hasPhone,
  hasStreetAddress,
  honeypotTripped,
  makeHandle,
  summarizeCompanies,
  validateDate,
  validateDiscussion,
  validatePrice,
} from "../shared/rules.js";

const NOW = new Date("2026-11-19T15:00:00Z");

function price(overrides = {}) {
  return {
    supplier: "Example Supplier",
    county: "Antrim",
    town: "Example",
    price: "2.50",
    priceType: "locked-in",
    tank: "owned",
    date: "2026-11-01",
    fees: ["sales tax"],
    handle: "Blue Regulator 482",
    ...overrides,
  };
}

function throws(fn) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, "InputError");
    return true;
  });
}

test("price keeps county, tank, date, and fees", () => {
  const saved = validatePrice(price());
  assert.equal(saved.county, "Antrim");
  assert.equal(saved.tank, "owned");
  assert.equal(saved.date, "2026-11-01");
  assert.equal(saved.price, 2.5);
  assert.deepEqual(saved.fees, ["sales tax"]);
  assert.equal(saved.priceType, "locked-in");
});

test("town ZIP is accepted and a street address is not", () => {
  assert.equal(validatePrice(price({ town: "49770" })).town, "49770");
  assert.equal(validatePrice(price({ town: "St. Ignace" })).town, "St. Ignace");
  throws(() => validatePrice(price({ town: "123 Main St" })));
  throws(() => validatePrice(price({ county: "" })));
  throws(() => validatePrice(price({ tank: "borrowed" })));
});

test("price bounds and date window", () => {
  throws(() => validatePrice(price({ price: "0.49" })));
  throws(() => validatePrice(price({ price: "10" })));
  throws(() => validatePrice(price({ price: "2.999" })));
  assert.equal(validateDate("2024-11-19", NOW), "2024-11-19");
  throws(() => validateDate("2024-11-18", NOW));
  assert.equal(validateDate("2026-11-20", NOW), "2026-11-20");
  throws(() => validateDate("2026-11-21", NOW));
  throws(() => validateDate("2026-02-31", NOW));
  throws(() => validateDate("2025-02-29", NOW));
});

test("phone numbers and street addresses are blocked in free text", () => {
  for (const sample of [
    "231-555-0199",
    "(231) 555-0199",
    "231.555.0199",
    "2315550199",
    "+1 231 555 0199",
    "1-231-555-0199",
  ]) {
    assert.equal(hasPhone(sample), true, sample);
  }
  for (const sample of ["49770", "2.49", "500 gallon tank", "2026-11-01"]) {
    assert.equal(hasPhone(sample), false, sample);
  }
  assert.equal(hasStreetAddress("123 Main Street"), true);
  assert.equal(hasStreetAddress("45 Oak Avenue"), true);
  assert.equal(hasStreetAddress("PO Box 12"), true);
  assert.equal(hasStreetAddress("P.O. Box 88"), true);
  assert.equal(hasStreetAddress("500 gallon tank"), false);
  assert.equal(hasStreetAddress("I have a 500 gallon tank"), false);
  throws(() => validateDiscussion({
    title: "Delivery",
    body: "Call me at 231-555-0199",
    category: "delivery",
    handle: "Blue Regulator 482",
  }));
  throws(() => validateDiscussion({
    title: "Note",
    body: "I am at 12 Oak Lane",
    category: "rants",
    handle: "Blue Regulator 482",
  }));
  const ok = validateDiscussion({
    title: "Tank size",
    body: "I have a 500 gallon tank.",
    category: "prices",
    handle: "not a real name",
  });
  assert.equal(ok.handle, "Anonymous");
  assert.equal(ok.category, "prices");
});

test("emails, links, and custom names are not kept", () => {
  assert.equal(containsBlockedContact("me@example.com"), "email");
  assert.equal(containsBlockedContact("see example.com"), "url");
  throws(() => validatePrice(price({ supplier: "example.com" })));
  assert.equal(cleanHandle("Blue Regulator 482"), "Blue Regulator 482");
  assert.equal(cleanHandle("blue regulator 482"), "Blue Regulator 482");
  assert.equal(cleanHandle("John Smith"), "Anonymous");
  assert.equal(cleanHandle("John Smith 123"), "Anonymous");
  assert.equal(cleanHandle(makeHandle(() => 0)), makeHandle(() => 0));
});

test("honeypot only trips when the extra field is filled", () => {
  assert.equal(honeypotTripped({ hp: "" }), false);
  assert.equal(honeypotTripped({}), false);
  assert.equal(honeypotTripped({ hp: "https://spam.example" }), true);
  assert.equal(honeypotTripped({ hp: ["x"] }), true);
});

test("company averages never mix price types", () => {
  const prices = [
    { supplier: "B Co", price: 2, type: "locked-in" },
    { supplier: "B Co", price: 3, type: "locked-in" },
    { supplier: "B Co", price: 4, type: "will-call" },
    { supplier: "A Co", price: 9, type: "mystery" },
    { supplier: "A Co", price: 5, type: "budget" },
  ];
  const rows = summarizeCompanies(prices);
  assert.deepEqual(rows.map((row) => row.name), ["A Co", "B Co"]);
  const blended = (2 + 3 + 4) / 3;
  const mixed = rows[1];
  assert.equal(mixed.lockedAvg, 2.5);
  assert.equal(mixed.lockedCount, 2);
  assert.equal(mixed.willAvg, 4);
  assert.equal(mixed.willCount, 1);
  assert.equal(mixed.budgetAvg, null);
  assert.notEqual(mixed.lockedAvg, blended);
  assert.notEqual(mixed.willAvg, blended);
  assert.equal(rows[0].budgetAvg, 5);
  assert.equal(rows[0].lockedAvg, null);
  assert.equal(rows[0].willAvg, null);
  const groups = groupPrices(prices);
  assert.deepEqual(groups.map((group) => group.key), ["locked-in", "will-call", "budget"]);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[0].items.some((item) => item.type === "will-call"), false);
});

test("limits used in the privacy page match the code", () => {
  const privacy = readFileSync("privacy.html", "utf8");
  const terms = readFileSync("terms.html", "utf8");
  assert.match(privacy, /five posts/i);
  assert.match(privacy, /twenty reports/i);
  assert.match(privacy, /Three reports/);
  assert.match(terms, /three reports/i);
  assert.equal(LIMITS.postsPerHour, 5);
  assert.equal(LIMITS.reportsPerHour, 20);
  assert.equal(LIMITS.reportsToHide, 3);
});

test("pages tell the truth about sharing and do not name an operator", () => {
  const index = readFileSync("index.html", "utf8");
  assert.match(index, /property="og:title"/);
  assert.match(index, /property="og:description"/);
  assert.match(index, /property="og:image"/);
  assert.match(index, /rel="icon"/);
  assert.match(index, /privacy\.html/);
  assert.match(index, /terms\.html/);
  assert.equal(index.includes("hero.jpg"), false);
  assert.equal(index.includes("WEB_APP_URL"), false);
  const png = readFileSync("assets/og.png");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  for (const file of ["assets/favicon.png", "assets/icon-48.png", "assets/icon-192.png", "assets/icon-512.png"]) {
    assert.equal(existsSync(file), true, file);
  }
  assert.equal(existsSync("assets/hero.jpg"), false);
  assert.equal(existsSync("Code.gs"), false);
});

test("published text does not carry operator names or dropped promises", () => {
  const banned = [
    /fair america/i,
    /ellsworth/i,
    /micah/i,
    /\bEFE\b/,
    /EXIF/i,
    /verified bill/i,
    /\$1\.59/,
    /upvote/i,
    /mailto:/i,
    /script\.google\.com/i,
    /1TSYfLOIrsUbPrCxMxWTYNqAYqeQtPGer8gOGCoJuJU8/,
  ];
  const files = textFiles(".");
  assert.ok(files.length > 10);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
});

function textFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".wrangler", ".git", "screenshots", "assets/vendor"].includes(entry)) continue;
    const path = `${dir}/${entry}`.replace(/^\.\//, "");
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      if (entry === "vendor" && dir.endsWith("assets")) continue;
      textFiles(full, found);
      continue;
    }
    if (entry === "package-lock.json" || entry === "test.mjs") continue;
    if (/\.(html|js|mjs|md|css|json|toml|svg|py|yml)$/.test(entry)) found.push(full.replace(/^\.\//, ""));
  }
  return found;
}
