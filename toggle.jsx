import React from "react";

export default function Footer() {
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-edge mt-20 py-10 px-6"
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-parchment-dim font-cormorant">
        <div className="flex items-center gap-3">
          <span className="text-gold">❖</span>
          <span className="font-cinzel uppercase tracking-[0.25em] text-xs text-parchment-muted">
            Aurora Codex
          </span>
        </div>
        <p className="text-sm italic">
          Forged for the wanderers of Los&apos;thar — a D&amp;D 2024 grimoire.
        </p>
      </div>
    </footer>
  );
}
