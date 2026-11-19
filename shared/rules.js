// Shared posting rules for the page and the API.
// Locked-in, will-call, and budget prices are never averaged together.

export const LIMITS = {
  postsPerHour: 5,
  reportsPerHour: 20,
  reportsToHide: 3,
  maxSupplier: 80,
  maxTown: 40,
  maxTitle: 100,
  maxBody: 1000,
  priceMin: 0.5,
  priceMax: 9.99,
};

export const COUNTIES = [
  "Alpena",
  "Antrim",
  "Benzie",
  "Charlevoix",
  "Cheboygan",
  "Crawford",
  "Emmet",
  "Grand Traverse",
  "Kalkaska",
  "Leelanau",
  "Mackinac",
  "Manistee",
  "Missaukee",
  "Montmorency",
  "Oscoda",
  "Otsego",
  "Presque Isle",
  "Roscommon",
  "Wexford",
  "Other",
];

export const FEES = [
  "sales tax",
  "delivery/service",
  "environmental/hazmat",
  "tank rent/lease",
  "minimum-delivery",
  "after-hours",
  "leak check",
  "removal",
];

export const PRICE_TYPES = {
  "locked-in": "Locked-in / prebuy",
  "will-call": "Will-call",
  budget: "Budget",
};

export const CATEGORIES = [
  "prices",
  "fees",
  "delivery",
  "service",
  "switching tips",
  "rants",
];

export const ADJECTIVES = ["Blue", "Red", "Quiet", "Steady", "Northern", "Lake", "Pine", "Frost"];
export const NOUNS = ["Regulator", "Tank", "Gauge", "Delivery", "Fill", "Valve", "Line", "Burner"];

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

export function makeHandle(random = Math.random) {
  const adj = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];
  const num = 100 + Math.floor(random() * 900);
  return `${adj} ${noun} ${num}`;
}

export function cleanHandle(value) {
  const match = String(value ?? "").trim().match(/^([A-Za-z]+) ([A-Za-z]+) (\d{3})$/);
  if (!match) return "Anonymous";
  const adj = ADJECTIVES.find((item) => item.toLowerCase() === match[1].toLowerCase());
  const noun = NOUNS.find((item) => item.toLowerCase() === match[2].toLowerCase());
  if (!adj || !noun) return "Anonymous";
  return `${adj} ${noun} ${match[3]}`;
}

export function cleanDeviceId(value) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return "";
  return id;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "").trim()
  );
}

export function honeypotTripped(body) {
  if (!body || typeof body !== "object") return false;
  const value = body.hp;
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export function hasPhone(text) {
  return /(?<!\d)(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/.test(String(text ?? ""));
}

export function hasStreetAddress(text) {
  const value = String(text ?? "").replace(/\s+/g, " ");
  if (/\b(?:p\.?\s*o\.?\s*box|post\s+office\s+box)\s*#?\s*\d+/i.test(value)) return true;
  const pattern =
    /\b(\d{1,6})\s+([a-z0-9.'#-]+(?:\s+[a-z0-9.'#-]+){0,3})\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|trail|trl|highway|hwy|parkway|pkwy|place|pl|terrace|ter)\b\.?/gi;
  const skip = new Set([
    "gallon",
    "gallons",
    "gal",
    "liter",
    "liters",
    "mile",
    "miles",
    "dollar",
    "dollars",
    "per",
    "a",
    "the",
    "my",
    "our",
    "propane",
    "tank",
    "tanks",
    "price",
    "prices",
  ]);
  let match;
  while ((match = pattern.exec(value)) !== null) {
    const first = match[2].split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!skip.has(first)) return true;
  }
  return false;
}

export function hasUrl(text) {
  const value = String(text ?? "");
  if (/(?:https?:\/\/|www\.)\S+/i.test(value)) return true;
  return /\b[a-z0-9-]+\.(?:com|net|org|io|co|us|biz|info|edu|gov)\b/i.test(value);
}

export function containsBlockedContact(text) {
  const value = String(text ?? "");
  if (value.includes("@") || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return "email";
  if (hasPhone(value)) return "phone";
  if (hasUrl(value)) return "url";
  if (hasStreetAddress(value)) return "street";
  return "";
}

function rejectContact(text, message) {
  if (containsBlockedContact(text)) throw new InputError(message);
}

function rejectSpam(text) {
  if (/(.)\1{11,}/u.test(text)) throw new InputError("That post looks like spam.");
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "");
}

function cleanLine(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function cleanBlock(value) {
  return stripTags(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fromList(list, value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return list.find((item) => item.toLowerCase() === raw) || "";
}

export function parsePrice(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw)) {
    throw new InputError("Enter a price per gallon between 0.50 and 9.99.");
  }
  const price = Number(raw);
  if (price < LIMITS.priceMin || price > LIMITS.priceMax) {
    throw new InputError("Enter a price per gallon between 0.50 and 9.99.");
  }
  return Math.round(price * 100) / 100;
}

export function validateDate(value, now = new Date()) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InputError("Enter the date of this price.");
  const [year, month, day] = date.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new InputError("Enter the date of this price.");
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const newest = today + 24 * 60 * 60 * 1000;
  const oldest = Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate());
  if (stamp > newest) throw new InputError("The price date cannot be in the future.");
  if (stamp < oldest) throw new InputError("The price date is too old. Use a date within the last two years.");
  return date;
}

function validateFees(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Fees were not understood.");
  if (value.length > FEES.length) throw new InputError("Too many fees.");
  const fees = [];
  for (const item of value) {
    const match = fromList(FEES, item);
    if (!match) throw new InputError("One of the fees is not recognized.");
    if (!fees.includes(match)) fees.push(match);
  }
  return fees;
}

const CONTACT_MESSAGE = "Leave out phone numbers, email addresses, web addresses, and street addresses.";

export function validatePrice(input) {
  const supplier = cleanLine(input?.supplier);
  if (supplier.length < 2 || supplier.length > LIMITS.maxSupplier) {
    throw new InputError("Enter the supplier name.");
  }
  rejectSpam(supplier);
  rejectContact(supplier, CONTACT_MESSAGE);
  if (!/^[A-Za-z0-9][A-Za-z0-9 &.'’/-]*$/.test(supplier)) {
    throw new InputError("Enter the supplier name without a web address or phone number.");
  }
  const county = fromList(COUNTIES, input?.county);
  if (!county) throw new InputError("Choose a county.");
  const town = cleanLine(input?.town);
  if (/^\d{5}$/.test(town)) {
    // A 5-digit ZIP is enough. House numbers are not accepted in this field.
  } else if (town.length < 2 || town.length > LIMITS.maxTown || !/^[A-Za-z][A-Za-z .'-]*$/.test(town)) {
    throw new InputError("Enter a town name or a 5-digit ZIP, not a street address.");
  }
  rejectContact(town, "Town or ZIP only. No phone numbers or street addresses.");
  const priceType = fromList(Object.keys(PRICE_TYPES), input?.priceType);
  if (!priceType) throw new InputError("Choose locked-in, will-call, or budget.");
  const tank = String(input?.tank ?? "").trim().toLowerCase();
  if (tank !== "owned" && tank !== "leased") {
    throw new InputError("Say whether the tank is owned or leased.");
  }
  return {
    supplier,
    county,
    town,
    price: parsePrice(input?.price),
    priceType,
    tank,
    date: validateDate(input?.date),
    fees: validateFees(input?.fees),
    handle: cleanHandle(input?.handle),
  };
}

export function validateDiscussion(input) {
  const title = cleanLine(input?.title);
  if (title.length < 1 || title.length > LIMITS.maxTitle) throw new InputError("Enter a title.");
  const body = cleanBlock(input?.body);
  if (body.length < 1 || body.length > LIMITS.maxBody) {
    throw new InputError(`Keep the post under ${LIMITS.maxBody} characters.`);
  }
  rejectSpam(title);
  rejectSpam(body);
  rejectContact(`${title}\n${body}`, CONTACT_MESSAGE);
  const category = fromList(CATEGORIES, input?.category);
  if (!category) throw new InputError("Choose a category.");
  return {
    title,
    body,
    category,
    handle: cleanHandle(input?.handle),
  };
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

export function summarizeCompanies(prices) {
  const map = new Map();
  for (const price of prices) {
    if (!map.has(price.supplier)) {
      map.set(price.supplier, {
        name: price.supplier,
        lockedSum: 0,
        lockedCount: 0,
        willSum: 0,
        willCount: 0,
        budgetSum: 0,
        budgetCount: 0,
      });
    }
    const row = map.get(price.supplier);
    const amount = Number(price.price);
    if (!Number.isFinite(amount)) continue;
    if (price.type === "locked-in") {
      row.lockedSum += amount;
      row.lockedCount += 1;
    } else if (price.type === "will-call") {
      row.willSum += amount;
      row.willCount += 1;
    } else if (price.type === "budget") {
      row.budgetSum += amount;
      row.budgetCount += 1;
    }
  }
  return [...map.values()]
    .map((row) => ({
      name: row.name,
      lockedAvg: row.lockedCount ? roundMoney(row.lockedSum / row.lockedCount) : null,
      lockedCount: row.lockedCount,
      willAvg: row.willCount ? roundMoney(row.willSum / row.willCount) : null,
      willCount: row.willCount,
      budgetAvg: row.budgetCount ? roundMoney(row.budgetSum / row.budgetCount) : null,
      budgetCount: row.budgetCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupPrices(prices) {
  return Object.entries(PRICE_TYPES).map(([key, label]) => ({
    key,
    label,
    items: prices.filter((price) => price.type === key),
  }));
}
