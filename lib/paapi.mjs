// Zero-dependency Amazon Product Advertising API 5.0 client for Amazon.de (PartnerNet DE).
// Plain ESM using built-in node:crypto and fetch so it runs in both Next.js and scripts/push.mjs.

import { createHash, createHmac } from "node:crypto";

const HOST = "webservices.amazon.de";
const REGION = "eu-west-1";
const SERVICE = "ProductAdvertisingAPI";
const MARKETPLACE = "www.amazon.de";

const PAAPI_RESOURCES = [
  "Images.Primary.Large",
  "Images.Primary.Medium",
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "Offers.Listings.Availability.Type",
  "Offers.Listings.DeliveryInfo.IsPrimeEligible",
  "Offers.Listings.Price",
  "Offers.Listings.SavingBasis",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256Hex = (data) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data, "utf8").digest();

/** Check whether all required PartnerNet PA-API credentials are present. */
export function hasPaApiCreds(creds) {
  return Boolean(
    creds &&
      typeof creds.accessKey === "string" &&
      creds.accessKey.trim() &&
      typeof creds.secretKey === "string" &&
      creds.secretKey.trim() &&
      typeof creds.partnerTag === "string" &&
      creds.partnerTag.trim(),
  );
}

/** Generate AWS Signature Version 4 headers for an Amazon PA-API 5.0 POST request. */
export function signPaApiRequest({ accessKey, secretKey, path, target, payload, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const contentType = "application/json; charset=utf-8";
  const contentEncoding = "amz-1.0";

  const canonicalHeaders =
    `content-encoding:${contentEncoding}\n` +
    `content-type:${contentType}\n` +
    `host:${HOST}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;

  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const payloadHash = sha256Hex(payload);
  const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Encoding": contentEncoding,
    "Content-Type": contentType,
    Host: HOST,
    "X-Amz-Date": amzDate,
    "X-Amz-Target": target,
  };
}

/** Normalize a PA-API 5.0 Item object into our internal deal fields. */
export function parsePaApiItem(item) {
  if (!item || !item.ASIN) return null;
  const listing = item.Offers?.Listings?.[0] ?? null;
  const rawPrice = listing?.Price?.Amount;
  const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;

  const rawOld = listing?.SavingBasis?.Amount;
  const rawSavingsAmt = listing?.Price?.Savings?.Amount;
  let oldPrice = typeof rawOld === "number" && Number.isFinite(rawOld) && rawOld > 0 ? rawOld : null;
  if (oldPrice == null && price != null && typeof rawSavingsAmt === "number" && rawSavingsAmt > 0) {
    oldPrice = Math.round((price + rawSavingsAmt) * 100) / 100;
  }

  let percentage =
    typeof listing?.Price?.Savings?.Percentage === "number" && Number.isFinite(listing.Price.Savings.Percentage)
      ? Math.round(listing.Price.Savings.Percentage)
      : null;
  if (percentage == null && price != null && oldPrice != null && oldPrice > price) {
    percentage = Math.round(100 * (1 - price / oldPrice));
  }

  return {
    asin: String(item.ASIN).toUpperCase(),
    title: item.ItemInfo?.Title?.DisplayValue ? String(item.ItemInfo.Title.DisplayValue).trim() : null,
    brand:
      item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ||
      item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue ||
      null,
    image: item.Images?.Primary?.Large?.URL || item.Images?.Primary?.Medium?.URL || null,
    price,
    oldPrice,
    percentage,
    inStock: listing ? listing.Availability?.Type !== "OutOfStock" : false,
    isPrime: Boolean(listing?.DeliveryInfo?.IsPrimeEligible),
    detailUrl: item.DetailPageURL || null,
  };
}

async function callPaApi(path, target, bodyObj, creds) {
  const payload = JSON.stringify(bodyObj);
  const headers = signPaApiRequest({
    accessKey: creds.accessKey.trim(),
    secretKey: creds.secretKey.trim(),
    path,
    target,
    payload,
  });
  const res = await fetch(`https://${HOST}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers,
    body: payload,
  });
  return res;
}

/**
 * Batch-lookup up to N ASINs via PA-API 5.0 GetItems (10 ASINs per request).
 * Respects the 1 req/sec default rate limit and retries HTTP 429 once.
 */
export async function getItemsByAsin(asins, creds, { log = console.log } = {}) {
  const out = new Map();
  if (!hasPaApiCreds(creds)) return out;

  const unique = [...new Set(asins.map((a) => String(a || "").trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))];
  if (unique.length === 0) return out;

  const path = "/paapi5/getitems";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";

  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const body = {
      ItemIds: batch,
      ItemIdType: "ASIN",
      PartnerTag: creds.partnerTag.trim(),
      PartnerType: "Associates",
      Marketplace: MARKETPLACE,
      Resources: PAAPI_RESOURCES,
    };

    try {
      let res = await callPaApi(path, target, body, creds);
      if (res.status === 429) {
        await sleep(2500);
        res = await callPaApi(path, target, body, creds);
      }
      if (!res.ok) {
        const errTxt = await res.text().catch(() => "");
        log(`paapi GetItems HTTP ${res.status}: ${errTxt.slice(0, 200)}`);
      } else {
        const json = await res.json();
        const items = json?.ItemsResult?.Items;
        if (Array.isArray(items)) {
          for (const raw of items) {
            const parsed = parsePaApiItem(raw);
            if (parsed) out.set(parsed.asin, parsed);
          }
        }
      }
    } catch (e) {
      log(`paapi GetItems error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (i + 10 < unique.length) await sleep(1100);
  }
  return out;
}

/**
 * Search discounted products on Amazon.de via PA-API 5.0 SearchItems.
 */
export async function searchDealsPaApi(
  { keywords, minSavingPercent = 30, minReviewsRating = 4, itemCount = 10 },
  creds,
) {
  if (!hasPaApiCreds(creds) || !keywords || !String(keywords).trim()) return [];
  const path = "/paapi5/searchitems";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
  const body = {
    Keywords: String(keywords).trim(),
    SearchIndex: "All",
    MinSavingPercent: Math.max(10, Math.min(95, Math.round(minSavingPercent))),
    MinReviewsRating: Math.max(1, Math.min(4, Math.round(minReviewsRating))),
    ItemCount: Math.max(1, Math.min(10, Math.round(itemCount))),
    PartnerTag: creds.partnerTag.trim(),
    PartnerType: "Associates",
    Marketplace: MARKETPLACE,
    Resources: PAAPI_RESOURCES,
  };

  let res = await callPaApi(path, target, body, creds);
  if (res.status === 429) {
    await sleep(2500);
    res = await callPaApi(path, target, body, creds);
  }
  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`PA-API SearchItems HTTP ${res.status}: ${errTxt.slice(0, 200)}`);
  }
  const json = await res.json();
  const items = json?.SearchResult?.Items;
  if (!Array.isArray(items)) return [];
  return items.map(parsePaApiItem).filter(Boolean);
}
