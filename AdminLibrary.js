// Move embedded base64 images out of the character `data` blob and into
// PocketBase file fields (`portrait` = single, `images` = gallery/inline).
//
// Flow (used by the API adapter):
//   1. extractBase64(data)  → replaces every base64 data: URI with a stable
//      placeholder token, returning the File objects to upload.
//   2. adapter uploads the files (PocketBase assigns final filenames).
//   3. applyUrls(tokenized, map) → swaps placeholders for the real file URLs.
// The stored `data` therefore contains only small URLs; images live as files.

const DATA_URI_RE = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const PORTRAIT_PLACEHOLDER = "__aurora_portrait__";

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function uriToFile(uri, baseName) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (mime.split("/")[1] || "png").split("+")[0];
  return new File([bytes], `${baseName}.${ext}`, { type: mime });
}

function walk(val, fn) {
  if (typeof val === "string") return fn(val);
  if (Array.isArray(val)) return val.map((v) => walk(v, fn));
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) out[k] = walk(val[k], fn);
    return out;
  }
  return val;
}

// Returns { tokenized, gallery:[{placeholder,file}], portraitFile, wantPortrait }.
// `portraitFile` is a File when meta.portraitUrl is a base64 image; the portrait
// is handled via the dedicated `portrait` field so the codex grid can thumbnail.
export function extractBase64(data) {
  const clone = JSON.parse(JSON.stringify(data || {}));

  let portraitFile = null;
  const meta = clone.meta && typeof clone.meta === "object" ? clone.meta : null;
  if (meta && typeof meta.portraitUrl === "string" && meta.portraitUrl.startsWith("data:")) {
    portraitFile = uriToFile(meta.portraitUrl, "portrait");
    if (portraitFile) meta.portraitUrl = PORTRAIT_PLACEHOLDER;
  }

  const gallery = [];
  const seen = {};
  const tokenized = walk(clone, (str) => {
    if (str.indexOf("data:") === -1) return str;
    return str.replace(DATA_URI_RE, (uri) => {
      const hash = hashString(uri);
      if (seen[hash]) return seen[hash];
      const placeholder = `__auroraimg_${hash}__`;
      const file = uriToFile(uri, hash);
      if (!file) return uri;
      gallery.push({ placeholder, file });
      seen[hash] = placeholder;
      return placeholder;
    });
  });

  return { tokenized, gallery, portraitFile };
}

// Swap placeholders back to real file URLs. `portraitUrl` may be null (keep the
// existing meta.portraitUrl value if it wasn't a placeholder).
export function applyUrls(tokenized, { portraitUrl, galleryMap }) {
  return walk(tokenized, (str) => {
    let out = str;
    if (portraitUrl != null && out.indexOf(PORTRAIT_PLACEHOLDER) !== -1) {
      out = out.split(PORTRAIT_PLACEHOLDER).join(portraitUrl);
    }
    if (out.indexOf("__auroraimg_") !== -1) {
      for (const ph of Object.keys(galleryMap || {})) {
        if (out.indexOf(ph) !== -1) out = out.split(ph).join(galleryMap[ph]);
      }
    }
    return out;
  });
}

export { PORTRAIT_PLACEHOLDER };
