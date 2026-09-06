import PocketBase from "pocketbase";

// Single PocketBase client. The SDK persists auth state in localStorage via
// pb.authStore, so login survives refreshes. Superuser creds are NEVER used
// here — the frontend only ever authenticates as a normal user, and access
// control is enforced by PocketBase collection API rules.
const POCKETBASE_URL = process.env.REACT_APP_POCKETBASE_URL;

export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

// The authenticated user record (SDK v0.23+ exposes `.record`; keep `.model`
// as a fallback for older builds).
export function authUser() {
  return pb.authStore.record || pb.authStore.model || null;
}

// Build a public file URL for a record's file field.
export function fileUrl(collection, recordId, filename, thumb) {
  if (!filename) return "";
  const base = `${POCKETBASE_URL}/api/files/${collection}/${recordId}/${filename}`;
  return thumb ? `${base}?thumb=${thumb}` : base;
}
