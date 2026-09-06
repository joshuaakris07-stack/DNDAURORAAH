import { pb, authUser, fileUrl } from "./pocketbase";
import { unpackFromCloud } from "./assets";
import { extractBase64, applyUrls } from "./images";

// ─────────────────────────────────────────────────────────────────────
// PocketBase-native API adapter.
//
// The app was written against a REST backend (axios `api.get/post/put/delete`
// returning `{ data }`). This adapter keeps that exact surface but fulfils
// every call with the PocketBase JS SDK, so the existing pages/components work
// unchanged. Access control is enforced by PocketBase collection API rules;
// the frontend only ever uses the logged-in user's token.
// ─────────────────────────────────────────────────────────────────────

const CHAR_LIST_FIELDS =
  "id,collectionId,collectionName,name,char_class,level,portrait,created,updated";

function ok(data) {
  return { data };
}

// Normalise PocketBase ClientResponseError into the axios-ish shape the UI
// already knows how to format (`e.response.data.detail`).
function fail(e) {
  const status = e?.status ?? e?.response?.status ?? 500;
  const detail =
    e?.response?.message ||
    e?.data?.message ||
    e?.message ||
    "Request failed";
  const err = new Error(detail);
  err.response = { data: { detail }, status };
  throw err;
}

function charSummary(rec) {
  return {
    id: rec.id,
    name: rec.name || "Unnamed",
    char_class: rec.char_class || "",
    level: rec.level || 1,
    portrait_url: rec.portrait
      ? fileUrl("characters", rec.id, rec.portrait, "300x400")
      : "",
    updated_at: rec.updated || "",
    created_at: rec.created || "",
  };
}

// This PocketBase build errors when sorting by the autodate system fields
// (created/updated), so we fetch unsorted and order client-side.
function byUpdatedDesc(a, b) {
  return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
}

const uid = () => authUser()?.id || "";

async function findUserByUsername(username) {
  return pb
    .collection("users")
    .getFirstListItem(`username="${String(username).toLowerCase()}"`);
}

// Create (if needed) then persist a character, moving any base64 images in
// `data` into PocketBase file fields (portrait + images) and storing only URLs.
async function writeCharacter({ id, owner, name, char_class, level, data }) {
  const clean = {
    name: name || "Unnamed Hero",
    char_class: char_class || "",
    level: Number(level) || 1,
  };

  // Hydrate legacy asset:// dedup tokens back to base64 so they migrate to files too.
  const hydrated = unpackFromCloud(data || {});
  const { tokenized, gallery, portraitFile } = extractBase64(hydrated);

  // Ensure the record exists (needed to attach files / build file URLs).
  if (!id) {
    const created = await pb.collection("characters").create({
      owner: owner || uid(), ...clean, data: {},
    });
    id = created.id;
  }

  const existing = await pb.collection("characters").getOne(id, { fields: "id,images,portrait" });
  const existingImages = existing.images || [];

  // Upload new files: append gallery images, set portrait.
  let portraitUrl = null;
  const galleryMap = {};
  if (portraitFile || gallery.length) {
    const fd = new FormData();
    if (portraitFile) fd.append("portrait", portraitFile);
    for (const g of gallery) fd.append("images+", g.file);
    const up = await pb.collection("characters").update(id, fd);
    const appended = (up.images || []).slice(existingImages.length);
    gallery.forEach((g, i) => {
      if (appended[i]) galleryMap[g.placeholder] = fileUrl("characters", id, appended[i]);
    });
    if (portraitFile && up.portrait) portraitUrl = fileUrl("characters", id, up.portrait);
  }

  const finalData = applyUrls(tokenized, { portraitUrl, galleryMap });
  const finalStr = JSON.stringify(finalData);

  // Drop gallery files no longer referenced; clear portrait if it was removed.
  const toRemove = existingImages.filter((fn) => !finalStr.includes(fn));
  const metaUrl = (finalData.meta && finalData.meta.portraitUrl) || "";
  const clearPortrait =
    !portraitFile && existing.portrait && !finalStr.includes(existing.portrait) &&
    !(typeof metaUrl === "string" && metaUrl.startsWith("http"));

  let rec;
  if (toRemove.length || clearPortrait) {
    const fd = new FormData();
    fd.append("name", clean.name);
    fd.append("char_class", clean.char_class);
    fd.append("level", String(clean.level));
    fd.append("data", finalStr);
    for (const fn of toRemove) fd.append("images-", fn);
    if (clearPortrait) fd.append("portrait", "");
    rec = await pb.collection("characters").update(id, fd);
  } else {
    rec = await pb.collection("characters").update(id, { ...clean, data: finalData });
  }
  return rec;
}

// Portrait modal: set meta.portraitUrl (http URL / data: / "") then persist.
async function applyPortrait(id, portraitUrl) {
  const rec = await pb.collection("characters").getOne(id);
  const data = rec.data && typeof rec.data === "object" ? rec.data : {};
  if (!data.meta || typeof data.meta !== "object") data.meta = {};
  if (portraitUrl) data.meta.portraitUrl = portraitUrl;
  else delete data.meta.portraitUrl;
  const saved = await writeCharacter({
    id, name: rec.name, char_class: rec.char_class, level: rec.level, data,
  });
  const summary = charSummary(saved);
  if (!saved.portrait && portraitUrl && !portraitUrl.startsWith("data:")) {
    summary.portrait_url = portraitUrl;
  }
  return summary;
}

// ── Route dispatch ───────────────────────────────────────────────────
async function handle(method, path, body) {
  // characters ------------------------------------------------------
  if (path === "/characters" && method === "GET") {
    const list = await pb.collection("characters").getFullList({
      filter: `owner="${uid()}"`,
      fields: CHAR_LIST_FIELDS,
    });
    return list.map(charSummary).sort(byUpdatedDesc);
  }
  if (path === "/characters" && method === "POST") {
    const rec = await writeCharacter({
      owner: uid(), name: body.name, char_class: body.char_class, level: body.level, data: body.data,
    });
    return charSummary(rec);
  }

  let m = path.match(/^\/characters\/([^/]+)\/portrait$/);
  if (m && method === "PUT") {
    return applyPortrait(m[1], (body.portrait_url || "").trim());
  }

  m = path.match(/^\/characters\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (method === "GET") {
      const rec = await pb.collection("characters").getOne(id);
      return { ...charSummary(rec), data: rec.data || {} };
    }
    if (method === "PUT") {
      const rec = await writeCharacter({
        id, name: body.name, char_class: body.char_class, level: body.level, data: body.data,
      });
      return charSummary(rec);
    }
    if (method === "DELETE") {
      await pb.collection("characters").delete(id);
      return { ok: true };
    }
  }

  // admin -----------------------------------------------------------
  if (path === "/admin/users" && method === "GET") {
    const [users, chars] = await Promise.all([
      pb.collection("users").getFullList(),
      pb.collection("characters").getFullList({ fields: "id,owner" }),
    ]);
    const counts = {};
    for (const ch of chars) counts[ch.owner] = (counts[ch.owner] || 0) + 1;
    users.sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name || "",
      role: u.role || "user",
      character_count: counts[u.id] || 0,
      created_at: u.created || "",
    }));
  }

  m = path.match(/^\/admin\/users\/([^/]+)\/characters$/);
  if (m && method === "GET") {
    const u = await findUserByUsername(m[1]);
    const list = await pb.collection("characters").getFullList({
      filter: `owner="${u.id}"`,
      fields: CHAR_LIST_FIELDS,
    });
    return list.map(charSummary).sort(byUpdatedDesc);
  }

  m = path.match(/^\/admin\/users\/([^/]+)\/characters\/([^/]+)$/);
  if (m) {
    const id = m[2];
    if (method === "GET") {
      const rec = await pb.collection("characters").getOne(id);
      return { ...charSummary(rec), data: rec.data || {} };
    }
    if (method === "PUT") {
      const rec = await writeCharacter({
        id, name: body.name, char_class: body.char_class, level: body.level, data: body.data,
      });
      return charSummary(rec);
    }
  }

  // library ---------------------------------------------------------
  const libMap = { "magic-items": "magic_items", spells: "spells" };
  m = path.match(/^\/library\/(magic-items|spells)$/);
  if (m) {
    const col = libMap[m[1]];
    if (method === "GET") {
      return pb.collection(col).getFullList({
        sort: col === "spells" ? "level,name" : "name",
      });
    }
    if (method === "POST") {
      return pb.collection(col).create({ ...body, created_by: authUser()?.username || "" });
    }
  }
  m = path.match(/^\/library\/(magic-items|spells)\/([^/]+)$/);
  if (m) {
    const col = libMap[m[1]];
    const id = m[2];
    if (method === "PUT") {
      const { id: _drop, ...rest } = body || {};
      return pb.collection(col).update(id, rest);
    }
    if (method === "DELETE") {
      await pb.collection(col).delete(id);
      return { ok: true };
    }
  }

  const err = new Error(`No adapter route for ${method} ${path}`);
  err.response = { data: { detail: "Not found" }, status: 404 };
  throw err;
}

async function call(method, path, body) {
  try {
    const data = await handle(method, path, body);
    return ok(data);
  } catch (e) {
    if (e?.response) throw e; // already normalised (route-not-found)
    return fail(e);
  }
}

export const api = {
  get: (path) => call("GET", path),
  post: (path, body) => call("POST", path, body),
  put: (path, body) => call("PUT", path, body),
  delete: (path) => call("DELETE", path),
};

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : typeof e === "string" ? e : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail === "object") {
    if (typeof detail.detail !== "undefined") return formatApiErrorDetail(detail.detail);
    if (typeof detail.error !== "undefined") return formatApiErrorDetail(detail.error);
    if (typeof detail.message === "string") return detail.message;
    if (typeof detail.msg === "string") return detail.msg;
    try { return JSON.stringify(detail); } catch (_) { return "Unknown error"; }
  }
  return String(detail);
}
