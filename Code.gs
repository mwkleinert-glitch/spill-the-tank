/**
 * Spill the Tank — Google Apps Script backend
 * Bound to the "Spill the Tank - Posts" spreadsheet.
 *
 * Deploy: Extensions > Apps Script > paste this into Code.gs
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *   Copy the Web app URL and put it in index.html as WEB_APP_URL.
 */

const SPREADSHEET_ID = '1TSYfLOIrsUbPrCxMxWTYNqAYqeQtPGer8gOGCoJuJU8';
const MAX_POSTS_PER_HOUR = 5;
const PRICE_MIN = 0.50;
const PRICE_MAX = 9.99;
const MAX_TEXT = 500;

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const prices = getLiveRows(ss.getSheetByName('Prices'), priceHeaders());
  const discuss = getLiveRows(ss.getSheetByName('Discuss'), discussHeaders());
  return ContentService
    .createTextOutput(JSON.stringify({ prices, discuss }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const deviceId = (data.deviceId || '').toString().slice(0, 64);
    if (!checkRateLimit(deviceId)) {
      return jsonResponse({ ok: false, error: 'Too many posts. Try again later.' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (data.action === 'report') {
      return handleReport(ss, data);
    }

    if (data.type === 'price') {
      return handlePrice(ss, data);
    }

    if (data.type === 'discuss') {
      return handleDiscuss(ss, data);
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Bad request' });
  }
}

function handlePrice(ss, data) {
  const price = parseFloat(data.price_per_gal);
  if (isNaN(price) || price < PRICE_MIN || price > PRICE_MAX) {
    return jsonResponse({ ok: false, error: 'Price must be between $0.50 and $9.99' });
  }
  const sheet = ss.getSheetByName('Prices');
  const row = [
    new Date().toISOString(),
    sanitize(data.town_zip),
    sanitize(data.supplier),
    sanitize(data.price_type),
    price,
    sanitize((data.fees_checked || []).join(', ')),
    sanitize(data.comment),
    data.hide_name ? 'Anonymous' : sanitize(data.display_name || 'Anonymous'),
    'live',
    0
  ];
  sheet.appendRow(row);
  return jsonResponse({ ok: true });
}

function handleDiscuss(ss, data) {
  const sheet = ss.getSheetByName('Discuss');
  const row = [
    new Date().toISOString(),
    sanitize(data.town_zip),
    sanitize(data.supplier),
    sanitize(data.post),
    data.hide_name ? 'Anonymous' : sanitize(data.display_name || 'Anonymous'),
    'live',
    0
  ];
  sheet.appendRow(row);
  return jsonResponse({ ok: true });
}

function handleReport(ss, data) {
  const sheetName = data.sheet === 'Discuss' ? 'Discuss' : 'Prices';
  const sheet = ss.getSheetByName(sheetName);
  const rows = sheet.getDataRange().getValues();
  const tsCol = 0;
  const statusCol = sheetName === 'Prices' ? 8 : 5;
  const reportCol = sheetName === 'Prices' ? 9 : 6;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][tsCol] === data.timestamp) {
      const count = (parseInt(rows[i][reportCol], 10) || 0) + 1;
      sheet.getRange(i + 1, reportCol + 1).setValue(count);
      if (count >= 3) {
        sheet.getRange(i + 1, statusCol + 1).setValue('hidden');
      }
      return jsonResponse({ ok: true, report_count: count });
    }
  }
  return jsonResponse({ ok: false, error: 'Post not found' });
}

function getLiveRows(sheet, headers) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const statusIdx = headers.indexOf('status');
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][statusIdx] === 'live') {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
      out.push(obj);
    }
  }
  return out;
}

function priceHeaders() {
  return ['timestamp','town_zip','supplier','price_type','price_per_gal','fees_checked','comment','display_name','status','report_count'];
}
function discussHeaders() {
  return ['timestamp','town_zip','supplier','post','display_name','status','report_count'];
}

function sanitize(str) {
  if (str == null) return '';
  return String(str).replace(/<[^>]*>/g, '').slice(0, MAX_TEXT);
}

function checkRateLimit(deviceId) {
  if (!deviceId) return true;
  const cache = CacheService.getScriptCache();
  const key = 'rate:' + deviceId;
  const current = parseInt(cache.get(key) || '0', 10);
  if (current >= MAX_POSTS_PER_HOUR) return false;
  cache.put(key, String(current + 1), 3600);
  return true;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
