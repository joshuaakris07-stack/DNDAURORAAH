import React, { createContext, useContext, useEffect, useState } from "react";
import { pb, authUser } from "../lib/pocketbase";

const AuthContext = createContext(null);

function toPublic(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    username: rec.username,
    name: rec.name || "",
    role: rec.role || "user",
    created_at: rec.created || null,
  };
}

function describeError(e) {
  const data = e?.response || e?.data;
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message) {
      // Surface the first field-level validation message when present.
      const fields = data.data && typeof data.data === "object" ? data.data : null;
      if (fields) {
        const first = Object.values(fields)[0];
        if (first && first.message) return `${data.message} — ${first.message}`;
      }
      return data.message;
    }
  }
  return e?.message || "Something went wrong.";
}

export function AuthProvider({ children }) {
  // null = checking, false = anonymous, object = authenticated
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pb.authStore.isValid) {
        if (!cancelled) setUser(false);
        return;
      }
      try {
        // Verify + refresh the persisted token; also refreshes the record.
        await pb.collection("users").authRefresh();
        if (!cancelled) setUser(toPublic(authUser()));
      } catch (_e) {
        pb.authStore.clear();
        if (!cancelled) setUser(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = async ({ username, password }) => {
    try {
      await pb.collection("users").authWithPassword(String(username).toLowerCase(), password);
      const u = toPublic(authUser());
      setUser(u);
      return { ok: true, user: u };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  };

  const register = async ({ username, password, name }) => {
    const uname = String(username).toLowerCase();
    try {
      await pb.collection("users").create({
        username: uname,
        email: `${uname}@aurora.local`,
        emailVisibility: false,
        password,
        passwordConfirm: password,
        name,
        role: "user",
      });
      await pb.collection("users").authWithPassword(uname, password);
      const u = toPublic(authUser());
      setUser(u);
      return { ok: true, user: u };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  };

  const logout = async () => {
    pb.authStore.clear();
    setUser(false);
  };

  const changePassword = async ({ oldPassword, newPassword }) => {
    const u = authUser();
    if (!u) return { ok: false, error: "Not signed in." };
    try {
      await pb.collection("users").update(u.id, {
        oldPassword,
        password: newPassword,
        passwordConfirm: newPassword,
      });
      // Changing the password invalidates the current token → re-authenticate.
      await pb.collection("users").authWithPassword(u.username, newPassword);
      setUser(toPublic(authUser()));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  };

  const updateName = async (name) => {
    const u = authUser();
    if (!u) return { ok: false, error: "Not signed in." };
    try {
      const rec = await pb.collection("users").update(u.id, { name });
      setUser(toPublic(rec));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, changePassword, updateName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
