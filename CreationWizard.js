import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";

// Searchable browser over the shared admin library (`/library/magic-items`
// and `/library/spells`). On row click the selected entry is inserted
// into the player's open sheet via the same-origin iframe helpers
// `window._insertLibraryItem` / `window._insertLibrarySpell` exposed by
// aurora.html.

const fmtErr = (e) => formatApiErrorDetail(e?.response?.data) || e?.message || String(e);

export default function LibraryBrowser({ open, onClose, iframeWindow }) {
  const [tab, setTab] = useState("items");
  const [items, setItems] = useState(null);
  const [spells, setSpells] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    (async () => {
      try {
        const [i, s] = await Promise.all([
          api.get("/library/magic-items"),
          api.get("/library/spells"),
        ]);
        setItems(i.data || []);
        setSpells(s.data || []);
      } catch (e) {
        toast.error(fmtErr(e));
        setItems([]); setSpells([]);
      }
    })();
  }, [open]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((x) => ["name", "rarity", "item_type", "description"]
      .some((k) => String(x[k] || "").toLowerCase().includes(q)));
  }, [items, search]);
  const filteredSpells = useMemo(() => {
    if (!spells) return [];
    if (!search) return spells;
    const q = search.toLowerCase();
    return spells.filter((x) => ["name", "school", "description"]
      .some((k) => String(x[k] || "").toLowerCase().includes(q)));
  }, [spells, search]);

  if (!open) return null;

  const insertItem = (it) => {
    const fn = iframeWindow?._insertLibraryItem;
    if (typeof fn !== "function") {
      toast.error("Sheet not ready — please wait a moment and try again.");
      return;
    }
    const ok = fn(it);
    if (ok) toast.success(`Added "${it.name}" to inventory`);
    else toast.error(`Couldn't add "${it.name}"`);
  };
  const insertSpell = (sp) => {
    const fn = iframeWindow?._insertLibrarySpell;
    if (typeof fn !== "function") {
      toast.error("Sheet not ready — please wait a moment and try again.");
      return;
    }
    const ok = fn(sp);
    if (ok) toast.success(`Added "${sp.name}" to ${sp.level === 0 ? "cantrips" : `level ${sp.level} spells`}`);
    else toast.error(`Couldn't add "${sp.name}"`);
  };

  return (
    <div
      data-testid="library-browser-overlay"
      className="fixed inset-0 z-[80] bg-ink/85 backdrop-blur-sm flex items-start sm:items-center justify-center px-3 py-6 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-leather border border-gold/40 w-full max-w-4xl shadow-2xl my-4">
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between gap-3">
          <div>
            <p className="font-cinzel text-gold text-[10px] tracking-[0.4em] uppercase">Browse</p>
            <h2 className="font-cormorant italic text-parchment text-2xl">Library</h2>
          </div>
          <button type="button" onClick={onClose} data-testid="library-close"
            className="font-cinzel text-[10px] tracking-[0.25em] uppercase text-parchment-muted hover:text-parchment">
            Close ✕
          </button>
        </div>

        <div className="px-6 pt-3 flex gap-0 border-b border-edge">
          {["items", "spells"].map((t) => (
            <button key={t} type="button" data-testid={`lib-tab-${t}`}
              onClick={() => setTab(t)}
              className={
                "px-5 py-2 font-cinzel text-[10px] tracking-[0.25em] uppercase transition-colors " +
                (tab === t ? "text-gold border-b-2 border-gold" : "text-parchment-muted hover:text-parchment")
              }>
              {t === "items" ? `Items (${items?.length ?? "…"})` : `Spells (${spells?.length ?? "…"})`}
            </button>
          ))}
        </div>

        <div className="px-6 py-3 border-b border-edge">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "items" ? "Search items by name, rarity, type…" : "Search spells by name, school…"}
            data-testid="library-search-input"
            className="w-full bg-ink/60 border border-edge focus:border-gold outline-none px-3 py-2 font-cormorant text-parchment"
          />
        </div>

        <div className="px-6 py-3 max-h-[60vh] overflow-y-auto">
          {tab === "items" && (
            <ul className="space-y-2" data-testid="lib-items-list">
              {filteredItems.length === 0 && (
                <li className="font-cormorant italic text-parchment-dim">No matching items in the library yet.</li>
              )}
              {filteredItems.map((it) => (
                <li key={it.id} className="border border-edge bg-ink/40 px-4 py-3 flex items-start justify-between gap-3"
                    data-testid={`lib-item-${it.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h4 className="font-cormorant italic text-parchment text-lg">{it.name}</h4>
                      <span className="font-cinzel text-[9px] uppercase tracking-[0.2em] text-gold">{it.rarity}</span>
                      <span className="font-cinzel text-[9px] uppercase tracking-[0.2em] text-parchment-muted">
                        {it.item_type}{it.attunement ? " · attune" : ""}{it.charges ? ` · ${it.charges}` : ""}
                      </span>
                    </div>
                    {it.description && (
                      <p className="font-cormorant text-parchment text-sm mt-1 line-clamp-2 whitespace-pre-wrap">{it.description}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => insertItem(it)}
                    data-testid={`lib-add-item-${it.id}`}
                    className="px-3 py-1 bg-crimson hover:bg-crimson-dark text-parchment font-cinzel text-[9px] tracking-[0.2em] uppercase border border-edge shrink-0">
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tab === "spells" && (
            <ul className="space-y-2" data-testid="lib-spells-list">
              {filteredSpells.length === 0 && (
                <li className="font-cormorant italic text-parchment-dim">No matching spells in the library yet.</li>
              )}
              {filteredSpells.map((sp) => (
                <li key={sp.id} className="border border-edge bg-ink/40 px-4 py-3 flex items-start justify-between gap-3"
                    data-testid={`lib-spell-${sp.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h4 className="font-cormorant italic text-parchment text-lg">{sp.name}</h4>
                      <span className="font-cinzel text-[9px] uppercase tracking-[0.2em] text-gold">
                        {sp.level === 0 ? "Cantrip" : `Lvl ${sp.level}`}
                      </span>
                      <span className="font-cinzel text-[9px] uppercase tracking-[0.2em] text-parchment-muted">
                        {sp.school} · {sp.casting_time} · {sp.range_text}
                      </span>
                    </div>
                    {sp.description && (
                      <p className="font-cormorant text-parchment text-sm mt-1 line-clamp-2 whitespace-pre-wrap">{sp.description}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => insertSpell(sp)}
                    data-testid={`lib-add-spell-${sp.id}`}
                    className="px-3 py-1 bg-crimson hover:bg-crimson-dark text-parchment font-cinzel text-[9px] tracking-[0.2em] uppercase border border-edge shrink-0">
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
