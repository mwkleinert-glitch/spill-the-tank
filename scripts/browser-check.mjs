import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.WEB_URL || "http://127.0.0.1:4173/";
const OUT = process.env.SCREENSHOT_DIR || "screenshots";

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[month - 1]} ${day}, ${year}`;
}

async function shoot(page, path) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path, fullPage: true });
}

async function fillPrice(page, fields) {
  await page.getByLabel("Supplier", { exact: true }).fill(fields.supplier);
  await page.getByLabel("County", { exact: true }).selectOption(fields.county);
  await page.getByLabel("Town or ZIP", { exact: true }).fill(fields.town);
  await page.getByLabel("Price per gallon", { exact: true }).fill(fields.price);
  await page.getByLabel("Price type", { exact: true }).selectOption(fields.priceType);
  await page.getByLabel("Tank", { exact: true }).selectOption(fields.tank);
  await page.getByLabel("Price date", { exact: true }).fill(fields.date);
  if (fields.fee) await page.getByLabel(fields.fee, { exact: true }).check();
  await page.getByRole("button", { name: "Post price anonymously" }).click();
  await page.getByTestId("notice").waitFor();
}

const lockedDate = daysAgo(10);
const willDate = daysAgo(20);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const first = await desktop.newPage();
  await first.goto(BASE, { waitUntil: "load" });
  await first.getByLabel("Supplier", { exact: true }).waitFor();
  const firstHandle = (await first.getByTestId("handle").innerText()).trim();
  await fillPrice(first, {
    supplier: "Example Supplier",
    county: "Antrim",
    town: "Example",
    price: "2.00",
    priceType: "locked-in",
    tank: "owned",
    date: lockedDate,
    fee: "sales tax",
  });
  const lockedCard = first.getByTestId("price-card").filter({ hasText: "Example Supplier" });
  await lockedCard.waitFor();
  await lockedCard.getByText(`Example, Antrim County`).waitFor();
  await lockedCard.getByText("Owned tank").waitFor();
  await lockedCard.getByText(`Price date ${dateLabel(lockedDate)}`).waitFor();
  await lockedCard.getByText("Fees noted: sales tax").waitFor();
  await lockedCard.getByText(`Posted by ${firstHandle}`).waitFor();
  await shoot(first, `${OUT}/desktop_post_persisted.png`);

  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await fresh.newPage();
  await second.goto(BASE, { waitUntil: "load" });
  await second.getByTestId("handle").waitFor();
  let secondHandle = (await second.getByTestId("handle").innerText()).trim();
  if (secondHandle === firstHandle) {
    await second.getByTestId("new-handle").click();
    secondHandle = (await second.getByTestId("handle").innerText()).trim();
  }
  if (secondHandle === firstHandle) throw new Error("The second visitor reused the first handle.");
  const seen = second.getByTestId("price-card").filter({ hasText: "Example Supplier" });
  await seen.getByText(`Posted by ${firstHandle}`).waitFor();
  await seen.getByText("Example, Antrim County").waitFor();
  if ((await second.getByTestId("price-card").count()) !== 1) {
    throw new Error("The second visitor did not see exactly the post that was just saved.");
  }
  await shoot(second, `${OUT}/desktop_second_visitor.png`);

  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await mobile.newPage();
  await phone.goto(BASE, { waitUntil: "load" });
  await phone.getByText(`Posted by ${firstHandle}`).waitFor();
  await fillPrice(phone, {
    supplier: "Example Supplier",
    county: "Charlevoix",
    town: "Example",
    price: "4.00",
    priceType: "will-call",
    tank: "leased",
    date: willDate,
  });
  await phone.getByText("Leased tank").waitFor();
  await phone.getByText(`Example, Charlevoix County`).waitFor();
  await phone.getByText(`Price date ${dateLabel(willDate)}`).waitFor();
  const willSection = phone.locator("section", { has: phone.getByRole("heading", { name: "Will-call" }) });
  await willSection.getByText("$4.00/gal").waitFor();
  const lockedSection = phone.locator("section", { has: phone.getByRole("heading", { name: "Locked-in / prebuy" }) });
  await lockedSection.getByText("$2.00/gal").waitFor();
  if (await lockedSection.getByText("$4.00/gal").count()) {
    throw new Error("Will-call price showed up in the locked-in list.");
  }
  await shoot(phone, `${OUT}/mobile_post_persisted.png`);

  await second.getByRole("button", { name: "Reload" }).click();
  await second.getByText("Leased tank").waitFor();
  await second.getByRole("button", { name: "Companies" }).click();
  await second.getByText("Locked-in / prebuy average: $2.00/gal (1 report)").waitFor();
  await second.getByText("Will-call average: $4.00/gal (1 report)").waitFor();
  const companies = await second.locator("body").innerText();
  if (companies.includes("$3.00")) throw new Error("Company view showed a blended price.");
  await shoot(second, `${OUT}/companies_separate.png`);

  await second.goto(new URL("privacy.html", BASE).toString(), { waitUntil: "load" });
  await second.getByRole("heading", { name: "Privacy" }).waitFor();
  await second.getByText("No bill, photo, or other file upload.").waitFor();
  await shoot(second, `${OUT}/privacy_page.png`);
  await second.goto(BASE, { waitUntil: "load" });
  await second.getByRole("button", { name: "Dark" }).click();
  await second.locator("html.dark").waitFor();
  console.log("browser check passed");
} finally {
  await browser.close();
}
