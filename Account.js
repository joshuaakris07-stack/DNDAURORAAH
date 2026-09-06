// Deduplicate large embedded base64 `data:` URIs across a character blob.
//
// Heavy sheets embed gallery / inline images as base64 inside the HTML. The
// save model keeps a full-sheet copy in `__autosave` (and each `__slots`
// entry), so every image was serialized N times — ballooning the cloud
// payload to 2x+ and breaking serverless payload limits.
//
// packForCloud() extracts every sizeable image into a shared `__assets`
// pool and replaces each occurrence with an `asset://<hash>-<len>` token.
// Identical images collapse to a single pool entry, so duplicating the
// sheet no longer duplicates its images. unpackFromCloud() rehydrates the
// tokens back into full data URIs. The character-sheet iframe therefore
// always sees normal, complete images — only the cloud copy is tokenized.

const DATA_URI_RE =
  /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const TOKEN_RE = /asset:\/\/[a-f0-9]+-\d+/g;
const MIN_LEN = 512; // only dedupe blobs worth the bookkeeping
const PREFIX = "asset://";

// FNV-1a 32-bit → hex. Length is appended to the token to make accidental
// collisions effectively impossible for our use.
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function dehydrateValue(val, assets, key) {
  if (typeof val === "string") {
    if (val.indexOf("data:") === -1) return val;
    return val.replace(DATA_URI_RE, (m) => {
      if (m.length < MIN_LEN) return m;
      const token = PREFIX + hashString(m) + "-" + m.length;
      assets[token] = m;
      return token;
    });
  }
  if (Array.isArray(val)) return val.map((v) => dehydrateValue(v, assets, key));
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) out[k] = dehydrateValue(val[k], assets, k);
    return out;
  }
  return val;
}

function hydrateValue(val, assets) {
  if (typeof val === "string") {
    if (val.indexOf(PREFIX) === -1) return val;
    return val.replace(TOKEN_RE, (t) => (assets[t] != null ? assets[t] : t));
  }
  if (Array.isArray(val)) return val.map((v) => hydrateValue(v, assets));
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) out[k] = hydrateValue(val[k], assets);
    return out;
  }
  return val;
}

// Pack a full character blob for the cloud: extract images into __assets.
// Returns the original blob untouched if there is nothing worth deduping.
export function packForCloud(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const assets = {};
  const tokenized = dehydrateValue(blob, assets, null);
  if (Object.keys(assets).length === 0) return blob;
  tokenized.__assets = assets;
  return tokenized;
}

// Unpack a stored blob: rehydrate tokens from __assets and drop the pool.
// Backward compatible — blobs without __assets are returned as-is.
export function unpackFromCloud(blob) {
  if (!blob || typeof blob !== "object") return blob;
  const { __assets, ...rest } = blob;
  if (!__assets || typeof __assets !== "object") return blob;
  return hydrateValue(rest, __assets);
}
