import {
  CATEGORIES,
  COUNTIES,
  FEES,
  PRICE_TYPES,
  cleanHandle,
  groupPrices,
  makeHandle,
  summarizeCompanies,
  validateDiscussion,
  validatePrice,
} from "./shared/rules.js";

const memoryStore = {};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore[key] ?? null;
  }
}

function storageSet(key, value) {
  memoryStore[key] = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing can block storage. The page still works for this visit.
  }
}

function todayInput() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function blankPrice() {
  return {
    supplier: "",
    county: "",
    town: "",
    price: "",
    priceType: "",
    tank: "owned",
    date: todayInput(),
  };
}

function blankPost() {
  return { title: "", body: "", category: "prices" };
}

function apiBase() {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return "http://127.0.0.1:8787";
  }
  const configured = String(window.STT_API_URL || "").trim().replace(/\/$/, "");
  if (!configured || configured.includes("REPLACE_WITH")) return "";
  return configured;
}

function ensureDeviceId() {
  const existing = storageGet("stt_device");
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const next = `d${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  storageSet("stt_device", next);
  return next;
}

function fillSelect(select, values) {
  if (!select || select.dataset.filled === "1") return;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.dataset.filled = "1";
}

async function postJson(url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not post right now. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data || data.ok === false) {
    throw new Error(data && data.error ? data.error : "Could not post right now.");
  }
  return data;
}

function app() {
  return {
    dark: document.documentElement.classList.contains("dark"),
    tab: "prices",
    apiBase: "",
    deviceId: "",
    handle: "",
    saving: false,
    notice: "",
    error: "",
    loadError: "",
    justPostedId: "",
    hpPrice: "",
    hpDiscuss: "",
    counties: COUNTIES,
    feeOptions: FEES,
    selectedFees: [],
    prices: [],
    discussions: [],
    newPrice: blankPrice(),
    newPost: blankPost(),
    init() {
      this.apiBase = apiBase();
      this.deviceId = ensureDeviceId();
      const saved = storageGet("stt_handle");
      this.handle = saved && cleanHandle(saved) === saved ? saved : makeHandle();
      storageSet("stt_handle", this.handle);
      this.loadPosts();
      if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js").catch(() => {});
        });
      }
    },
    toggleDark() {
      this.dark = !this.dark;
      document.documentElement.classList.toggle("dark", this.dark);
      storageSet("stt_dark", this.dark ? "1" : "0");
    },
    newHandle() {
      this.handle = makeHandle();
      storageSet("stt_handle", this.handle);
    },
    get priceGroups() {
      return groupPrices(this.prices);
    },
    get companyStats() {
      return summarizeCompanies(this.prices);
    },
    money(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return "";
      return `$${amount.toFixed(2)}`;
    },
    typeLabel(type) {
      return PRICE_TYPES[type] || "";
    },
    tankLabel(tank) {
      if (tank === "owned") return "Owned tank";
      if (tank === "leased") return "Leased tank";
      return "";
    },
    placeLabel(price) {
      if (price.county === "Other") return `${price.town} · Other`;
      return `${price.town}, ${price.county} County`;
    },
    formatDate(iso) {
      const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = months[Number(match[2]) - 1];
      if (!month) return "";
      return `${month} ${Number(match[3])}, ${match[1]}`;
    },
    daysAgo(timestamp) {
      const then = new Date(timestamp).getTime();
      if (!Number.isFinite(then)) return "";
      const days = Math.floor((Date.now() - then) / 86400000);
      if (days <= 0) return "today";
      if (days === 1) return "1 day ago";
      return `${days} days ago`;
    },
    async loadPosts() {
      this.loadError = "";
      if (!this.apiBase) {
        this.loadError = "This copy of the site does not have a server URL yet.";
        this.prices = [];
        this.discussions = [];
        return;
      }
      try {
        const response = await fetch(`${this.apiBase}/`, { cache: "no-store" });
        if (!response.ok) throw new Error("load failed");
        const data = await response.json();
        this.prices = Array.isArray(data.prices) ? data.prices : [];
        this.discussions = Array.isArray(data.discussions) ? data.discussions : [];
      } catch {
        this.loadError = "Could not load the board.";
      }
    },
    async addPrice() {
      this.notice = "";
      this.error = "";
      if (!this.apiBase) {
        this.error = "This copy of the site does not have a server URL yet.";
        return;
      }
      let price;
      try {
        price = validatePrice({ ...this.newPrice, fees: this.selectedFees, handle: this.handle });
      } catch (err) {
        this.error = err.message;
        return;
      }
      this.saving = true;
      try {
        const data = await postJson(`${this.apiBase}/`, {
          kind: "price",
          hp: this.hpPrice,
          deviceId: this.deviceId,
          ...price,
        });
        this.hpPrice = "";
        this.selectedFees = [];
        this.newPrice = blankPrice();
        this.notice = "Posted. Anyone who opens the board can see it.";
        this.justPostedId = data.id || "";
        await this.loadPosts();
        this.$nextTick(() => {
          const card = document.getElementById(`post-${this.justPostedId}`);
          if (card) card.scrollIntoView({ block: "center" });
        });
      } catch (err) {
        this.error = err.message || "Could not post right now.";
      } finally {
        this.saving = false;
      }
    },
    async addPost() {
      this.notice = "";
      this.error = "";
      if (!this.apiBase) {
        this.error = "This copy of the site does not have a server URL yet.";
        return;
      }
      let post;
      try {
        post = validateDiscussion({ ...this.newPost, handle: this.handle });
      } catch (err) {
        this.error = err.message;
        return;
      }
      this.saving = true;
      try {
        const data = await postJson(`${this.apiBase}/`, {
          kind: "discuss",
          hp: this.hpDiscuss,
          deviceId: this.deviceId,
          ...post,
        });
        this.hpDiscuss = "";
        this.newPost = blankPost();
        this.notice = "Posted. Anyone who opens the board can see it.";
        this.justPostedId = data.id || "";
        await this.loadPosts();
      } catch (err) {
        this.error = err.message || "Could not post right now.";
      } finally {
        this.saving = false;
      }
    },
    async reportPost(id) {
      this.notice = "";
      this.error = "";
      if (!this.apiBase) {
        this.error = "This copy of the site does not have a server URL yet.";
        return;
      }
      try {
        const data = await postJson(`${this.apiBase}/`, {
          kind: "report",
          deviceId: this.deviceId,
          id,
        });
        this.notice = data.duplicate ? "You already reported this." : "Report received.";
        await this.loadPosts();
      } catch (err) {
        this.error = err.message || "Could not report right now.";
      }
    },
  };
}

window.app = app;

if (typeof document !== "undefined") {
  fillSelect(document.getElementById("county"), COUNTIES);
  fillSelect(document.getElementById("category"), CATEGORIES);
}
