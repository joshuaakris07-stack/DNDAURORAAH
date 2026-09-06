import React, { useEffect, useMemo, useState } from "react";
import {
  SPECIES_LIST, SPECIES_INFO,
  CLASS_LIST, CLASS_INFO, CLASS_ACCENT, SUBCLASSES,
  BACKGROUND_INFO, BACKGROUND_LIST,
  ALIGNMENTS, POINT_COST, POINT_BUDGET,
  STARTING_EQUIPMENT, ABIL_KEYS, ABIL_LABEL,
  spentPoints,
} from "./creationWizardData";

const TOTAL_STEPS = 5;
const STEP_TITLES = ["Race & Class", "Class Details", "Background", "Abilities", "Equipment"];

// ── Small UI atoms ────────────────────────────────────────────────────

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-2 mb-5" data-testid="wizard-step-indicator">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={"h-1 flex-1 transition-colors " + (i + 1 <= step ? "bg-gold" : "bg-edge")}
        />
      ))}
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <label className="block font-cinzel text-[9px] tracking-[0.3em] uppercase text-parchment-muted mb-1">
      {children}
    </label>
  );
}

function StatChip({ label, value }) {
  return (
    <div className="border border-edge bg-ink/50 px-2 py-1.5">
      <div className="font-cinzel text-[8px] uppercase tracking-[0.25em] text-parchment-muted leading-tight">{label}</div>
      <div className="font-cormorant text-gold text-sm leading-snug mt-0.5">{value}</div>
    </div>
  );
}

// ── Race info card (D&D Beyond-style with art + subrace) ─────────────

function RaceCard({ species, subrace }) {
  const info = SPECIES_INFO[species];
  if (!info) return null;
  // If a subrace is picked, use its art + merge its trait list with the
  // parent's so the player sees the full picture.
  const sub = subrace && Array.isArray(info.subraces)
    ? info.subraces.find((s) => s.name === subrace)
    : null;
  const art = sub?.art || info.art;
  const traits = sub
    ? [...info.traits, ...(sub.traits || [])]
    : info.traits;
  const headerLabel = sub ? `${sub.name} ${species}` : species;
  return (
    <div
      data-testid="wizard-race-card"
      className="border border-gold/30 bg-gradient-to-br from-ink/60 to-leather/70 mt-3 overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row">
        {/* Portrait — wide on desktop, fills the row on mobile */}
        {art && (
          <div
            className="sm:w-44 sm:flex-none w-full h-44 sm:h-auto bg-ink/60 border-b sm:border-b-0 sm:border-r border-gold/25 overflow-hidden"
            data-testid="wizard-race-art"
          >
            <img
              src={`/race-art/${art}`}
              alt={headerLabel}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="px-4 py-2 border-b border-gold/30 bg-ink/40">
            <p className="font-cinzel text-[9px] uppercase tracking-[0.3em] text-parchment-muted">Species</p>
            <h3 className="font-cormorant italic text-parchment text-2xl leading-tight">{headerLabel}</h3>
          </div>
          <div className="px-4 py-3">
            <p className="font-cormorant italic text-parchment text-[15px] leading-relaxed mb-3">
              {info.flavor}
            </p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatChip label="Size" value={info.size} />
              <StatChip label="Speed" value={`${info.speed} ft`} />
              <StatChip label="Vision" value={info.vision} />
            </div>
            <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-1.5">
              {sub ? "Racial + Subrace Traits" : "Racial Traits"}
            </p>
            <ul className="space-y-1 text-parchment text-sm">
              {traits.map((t, i) => (
                <li key={i} className="pl-3 border-l-2 border-gold/40 leading-snug">{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Class info card (D&D Beyond-style with accent + tabs) ─────────────

function ClassCard({ className, currentLevel }) {
  const [tab, setTab] = useState("overview");
  const info = CLASS_INFO[className];
  const accent = CLASS_ACCENT[className] || "#c79a4d";
  useEffect(() => { setTab("overview"); }, [className]);
  if (!info) return null;

  const features = info.features || {};
  // 20-level progression: render every level row so the player can see
  // the whole arc, but tag the rows visually that fall within their
  // current level pick so it's obvious what they already get.
  const levelRows = Array.from({ length: 20 }, (_, i) => i + 1);

  return (
    <div
      data-testid="wizard-class-card"
      className="border bg-gradient-to-br from-ink/60 to-leather/70 mt-3"
      style={{ borderColor: accent + "66" }}
    >
      {/* Header banner */}
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: accent + "55",
          background: `linear-gradient(135deg, ${accent}28, rgba(15,12,9,0.25))`,
        }}
      >
        <p className="font-cinzel text-[9px] uppercase tracking-[0.3em] text-parchment-muted">Class</p>
        <h3 className="font-cormorant italic text-3xl leading-tight" style={{ color: accent }}>{className}</h3>
        <p className="font-cormorant italic text-parchment-dim text-[13px] mt-0.5">{info.tagline}</p>
      </div>

      {/* Sub-tab strip */}
      <div className="flex gap-0 border-b border-edge bg-ink/30 text-[10px] font-cinzel uppercase tracking-[0.2em]">
        {["overview", "features", "proficiencies"].map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`wizard-class-tab-${t}`}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 transition-colors " +
              (tab === t
                ? "text-parchment border-b-2"
                : "text-parchment-muted hover:text-parchment")
            }
            style={tab === t ? { borderColor: accent } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 max-h-[420px] overflow-y-auto">
        {tab === "overview" && (
          <>
            <p className="font-cormorant italic text-parchment text-[15px] leading-relaxed mb-3">
              {info.flavor}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatChip label="Hit Die" value={info.hitDie} />
              <StatChip label="Primary" value={info.primary} />
              <StatChip label="Saves" value={info.saves} />
              <StatChip label="Caster" value={info.caster} />
            </div>
          </>
        )}

        {tab === "features" && (
          <div className="space-y-1">
            <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-2">
              Progression — lvl 1 to 20
            </p>
            {levelRows.map((lvl) => {
              const fs = features[lvl] || [];
              if (fs.length === 0) return null;
              const reached = lvl <= currentLevel;
              return (
                <div
                  key={lvl}
                  className={
                    "flex items-start gap-3 py-1 px-2 border-l-2 " +
                    (reached ? "" : "opacity-50")
                  }
                  style={{ borderColor: reached ? accent : "transparent" }}
                >
                  <div className="font-cinzel text-[10px] uppercase tracking-[0.2em] w-12 shrink-0 mt-1"
                       style={{ color: reached ? accent : "var(--parchment-muted)" }}>
                    Lvl {lvl}
                  </div>
                  <div className="font-cormorant text-parchment text-[14px] leading-snug">
                    {fs.join(" • ")}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "proficiencies" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-1">Armor</p>
              <p className="font-cormorant text-parchment text-sm">{info.armor}</p>
            </div>
            <div>
              <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-1">Weapons</p>
              <p className="font-cormorant text-parchment text-sm">{info.weapons}</p>
            </div>
            <div>
              <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-1">Saving Throws</p>
              <p className="font-cormorant text-parchment text-sm">{info.saves}</p>
            </div>
            <div>
              <p className="font-cinzel text-[9px] uppercase tracking-[0.25em] text-parchment-muted mb-1">Spellcasting</p>
              <p className="font-cormorant text-parchment text-sm">{info.caster}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Background card ───────────────────────────────────────────────────

function BackgroundCard({ background }) {
  const info = BACKGROUND_INFO[background];
  if (!info || info.isCustom) return null;
  return (
    <div
      data-testid="wizard-background-card"
      className="border border-gold/30 bg-gradient-to-br from-ink/60 to-leather/70 mt-3"
    >
      <div className="px-4 py-2 border-b border-gold/30 bg-ink/40">
        <p className="font-cinzel text-[9px] uppercase tracking-[0.3em] text-parchment-muted">Background</p>
        <h3 className="font-cormorant italic text-parchment text-2xl leading-tight">{background}</h3>
      </div>
      <div className="px-4 py-3">
        <p className="font-cormorant italic text-parchment text-[15px] leading-relaxed mb-3">
          {info.description}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <StatChip label="Skills" value={info.skills.join(", ") || "—"} />
          <StatChip label="Tools" value={info.tools.join(", ") || "—"} />
          {info.languages.length > 0 && (
            <div className="sm:col-span-2">
              <StatChip label="Languages" value={info.languages.join(", ")} />
            </div>
          )}
          <div className="sm:col-span-2">
            <p className="font-cinzel text-[8px] uppercase tracking-[0.25em] text-parchment-muted mb-0.5">Starting Equipment</p>
            <p className="font-cormorant text-parchment text-[13px] leading-relaxed">{info.equipment}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────

export default function CreationWizard({ open, onClose, onSubmit, submitting }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [subrace, setSubrace] = useState("");
  const [className, setClassName] = useState("");
  const [subclass, setSubclass] = useState("");
  const [level, setLevel] = useState(1);
  const [background, setBackground] = useState("");
  const [customBg, setCustomBg] = useState({ name: "", skills: "", tools: "", equipment: "", description: "" });
  const [alignment, setAlignment] = useState("True Neutral");
  const [abilities, setAbilities] = useState({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  const [equipment, setEquipment] = useState([]);

  useEffect(() => {
    if (open) {
      setStep(1); setName(""); setSpecies(""); setSubrace(""); setClassName(""); setSubclass(""); setLevel(1);
      setBackground(""); setAlignment("True Neutral");
      setCustomBg({ name: "", skills: "", tools: "", equipment: "", description: "" });
      setAbilities({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
      setEquipment([]);
    }
  }, [open]);

  // When species changes, reset subrace if the new species doesn't list it.
  useEffect(() => {
    const subs = SPECIES_INFO[species]?.subraces;
    if (!subs) { setSubrace(""); return; }
    if (subrace && !subs.find((s) => s.name === subrace)) setSubrace("");
  }, [species, subrace]);

  useEffect(() => {
    if (!className) { setEquipment([]); setSubclass(""); return; }
    setEquipment((prev) => {
      const seed = STARTING_EQUIPMENT[className] || [];
      const all = Array.from(new Set([...seed, ...prev]));
      return all.map((label) => ({ label, checked: seed.includes(label) }));
    });
    if (subclass && !(SUBCLASSES[className] || []).includes(subclass)) setSubclass("");
  }, [className, subclass]);

  const spent = useMemo(() => spentPoints(abilities), [abilities]);
  const pointsLeft = POINT_BUDGET - spent;
  const bgInfo = background ? BACKGROUND_INFO[background] : null;

  if (!open) return null;

  const adjustAbil = (key, delta) => {
    setAbilities((prev) => {
      const next = { ...prev, [key]: prev[key] + delta };
      const v = next[key];
      if (v < 8 || v > 15) return prev;
      if (spentPoints(next) > POINT_BUDGET) return prev;
      return next;
    });
  };

  const canNext = (() => {
    if (step === 1) return name.trim().length > 0 && species && className;
    if (step === 2) return level >= 1 && level <= 20;
    if (step === 3) {
      if (!background) return false;
      if (background === "Custom") return customBg.name.trim().length > 0;
      return alignment.length > 0;
    }
    if (step === 4) return pointsLeft >= 0;
    return true;
  })();

  const finish = () => {
    const isCustom = background === "Custom";
    const bgPayload = isCustom
      ? {
          name: customBg.name.trim() || "Custom",
          skills: customBg.skills.split(",").map(s => s.trim()).filter(Boolean),
          tools:  customBg.tools.split(",").map(s => s.trim()).filter(Boolean),
          equipment: customBg.equipment.trim(),
          description: customBg.description.trim(),
          isCustom: true,
        }
      : {
          name: background,
          skills: bgInfo?.skills || [],
          tools:  bgInfo?.tools  || [],
          languages: bgInfo?.languages || [],
          equipment: bgInfo?.equipment || "",
          description: bgInfo?.description || "",
        };
    onSubmit({
      name: name.trim(),
      species, subrace, className, subclass,
      level: Number(level) || 1,
      background: bgPayload.name,
      backgroundDetails: bgPayload,
      alignment, abilities,
      equipment: equipment.filter((e) => e.checked).map((e) => e.label),
    });
  };

  return (
    <div
      data-testid="creation-wizard-overlay"
      className="fixed inset-0 z-[80] bg-ink/85 backdrop-blur-sm flex items-start sm:items-center justify-center px-3 py-6 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        data-testid="creation-wizard-modal"
        className="bg-leather border border-gold/40 w-full max-w-5xl shadow-2xl my-4"
      >
        {/* Header */}
        <div className="px-6 sm:px-8 pt-5 pb-3 border-b border-edge">
          <p className="font-cinzel text-gold text-[10px] tracking-[0.4em] uppercase mb-1">
            ❖ Forge a New Hero ❖
          </p>
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-cormorant italic text-parchment text-3xl leading-none">{STEP_TITLES[step - 1]}</h2>
            <p className="font-cormorant italic text-parchment-dim text-sm">
              Step {step} of {TOTAL_STEPS}
            </p>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-5">
          <StepIndicator step={step} />

          {/* ── Step 1: Identity + Race + Class with live cards ───── */}
          {step === 1 && (
            <div data-testid="wizard-step-1">
              <div className="mb-4">
                <FieldLabel>Hero name</FieldLabel>
                <input
                  data-testid="wizard-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  placeholder="e.g. Aurora the Bold"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <FieldLabel>Species</FieldLabel>
                  <select
                    data-testid="wizard-species"
                    value={species}
                    onChange={(e) => setSpecies(e.target.value)}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  >
                    <option value="">— choose —</option>
                    {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {SPECIES_INFO[species]?.subraces && (
                    <div className="mt-3">
                      <FieldLabel>Subrace</FieldLabel>
                      <select
                        data-testid="wizard-subrace"
                        value={subrace}
                        onChange={(e) => setSubrace(e.target.value)}
                        className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                      >
                        <option value="">— choose subrace —</option>
                        {SPECIES_INFO[species].subraces.map((s) => (
                          <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {species && <RaceCard species={species} subrace={subrace} />}
                </div>
                <div>
                  <FieldLabel>Class</FieldLabel>
                  <select
                    data-testid="wizard-class"
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  >
                    <option value="">— choose —</option>
                    {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {className && <ClassCard className={className} currentLevel={level} />}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Subclass + Level + class recap ────────────── */}
          {step === 2 && (
            <div data-testid="wizard-step-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <FieldLabel>Subclass</FieldLabel>
                  <select
                    data-testid="wizard-subclass"
                    value={subclass}
                    onChange={(e) => setSubclass(e.target.value)}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  >
                    <option value="">— optional —</option>
                    {(SUBCLASSES[className] || []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="font-cormorant italic text-parchment-dim text-xs mt-1">
                    Most classes pick a subclass at level 3 (2024 PHB).
                  </p>
                </div>
                <div>
                  <FieldLabel>Level (1–20)</FieldLabel>
                  <input
                    data-testid="wizard-level"
                    type="number" min={1} max={20}
                    value={level}
                    onChange={(e) => setLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  />
                  <p className="font-cormorant italic text-parchment-dim text-xs mt-1">
                    Spell slots and class trackers auto-populate at this level.
                  </p>
                </div>
              </div>
              {className && (
                <div className="mt-2">
                  <ClassCard className={className} currentLevel={level} />
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Background + alignment ────────────────────── */}
          {step === 3 && (
            <div data-testid="wizard-step-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <FieldLabel>Background</FieldLabel>
                  <select
                    data-testid="wizard-background"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  >
                    <option value="">— choose —</option>
                    {BACKGROUND_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Alignment</FieldLabel>
                  <select
                    data-testid="wizard-alignment"
                    value={alignment}
                    onChange={(e) => setAlignment(e.target.value)}
                    className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                  >
                    {ALIGNMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {bgInfo && !bgInfo.isCustom && <BackgroundCard background={background} />}

              {bgInfo?.isCustom && (
                <div data-testid="wizard-background-custom" className="border border-gold/30 bg-gradient-to-br from-ink/60 to-leather/70 mt-3">
                  <div className="px-4 py-2 border-b border-gold/30 bg-ink/40">
                    <p className="font-cinzel text-[9px] uppercase tracking-[0.3em] text-parchment-muted">Background</p>
                    <h3 className="font-cormorant italic text-parchment text-2xl">Custom</h3>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <p className="font-cormorant italic text-parchment-dim text-sm">
                      Define your own background. Filled-in fields will be written into the sheet&apos;s Notes tab.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <FieldLabel>Background name</FieldLabel>
                        <input
                          data-testid="wizard-bg-custom-name"
                          value={customBg.name}
                          onChange={(e) => setCustomBg((p) => ({ ...p, name: e.target.value }))}
                          className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                          placeholder="e.g. Star-Tongued Scrivener"
                        />
                      </div>
                      <div>
                        <FieldLabel>Skills (comma-sep.)</FieldLabel>
                        <input
                          data-testid="wizard-bg-custom-skills"
                          value={customBg.skills}
                          onChange={(e) => setCustomBg((p) => ({ ...p, skills: e.target.value }))}
                          className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                          placeholder="Arcana, History"
                        />
                      </div>
                      <div>
                        <FieldLabel>Tools (comma-sep.)</FieldLabel>
                        <input
                          data-testid="wizard-bg-custom-tools"
                          value={customBg.tools}
                          onChange={(e) => setCustomBg((p) => ({ ...p, tools: e.target.value }))}
                          className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                          placeholder="Calligrapher's supplies"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <FieldLabel>Starting equipment</FieldLabel>
                        <input
                          data-testid="wizard-bg-custom-equip"
                          value={customBg.equipment}
                          onChange={(e) => setCustomBg((p) => ({ ...p, equipment: e.target.value }))}
                          className="w-full bg-ink/60 border-b border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                          placeholder="Quill, journal, sealed letter, 10 gp"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <FieldLabel>Description / flavor</FieldLabel>
                        <textarea
                          data-testid="wizard-bg-custom-desc"
                          rows={2}
                          value={customBg.description}
                          onChange={(e) => setCustomBg((p) => ({ ...p, description: e.target.value }))}
                          className="w-full bg-ink/60 border border-edge focus:border-gold outline-none px-2 py-2 font-cormorant text-parchment"
                          placeholder="A short story or hook for your hero…"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Point-buy ─────────────────────────────────── */}
          {step === 4 && (
            <div data-testid="wizard-step-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-cormorant italic text-parchment-muted text-sm">
                  Distribute <b className="text-gold not-italic">27 points</b> (2024 standard).
                  Range 8–15 before species/feat bonuses.
                </p>
                <div
                  data-testid="wizard-points-left"
                  className={
                    "font-cinzel text-xs tracking-[0.2em] uppercase " +
                    (pointsLeft < 0 ? "text-crimson" : pointsLeft === 0 ? "text-emerald-400" : "text-gold")
                  }
                >
                  {pointsLeft} pts left
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {ABIL_KEYS.map((k) => (
                  <div key={k} className="border border-edge bg-ink/40 p-3" data-testid={`wizard-abil-${k}`}>
                    <div className="font-cinzel text-[10px] tracking-[0.3em] uppercase text-gold">{ABIL_LABEL[k]}</div>
                    <div className="flex items-center justify-between mt-2">
                      <button
                        type="button"
                        onClick={() => adjustAbil(k, -1)}
                        disabled={abilities[k] <= 8}
                        data-testid={`wizard-abil-${k}-dec`}
                        className="w-8 h-8 border border-edge text-parchment hover:bg-gold/10 disabled:opacity-30"
                      >−</button>
                      <span className="font-cormorant text-parchment text-2xl" data-testid={`wizard-abil-${k}-val`}>
                        {abilities[k]}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustAbil(k, +1)}
                        disabled={abilities[k] >= 15 || pointsLeft <= 0 - (POINT_COST[abilities[k] + 1] - POINT_COST[abilities[k]] - 1)}
                        data-testid={`wizard-abil-${k}-inc`}
                        className="w-8 h-8 border border-edge text-parchment hover:bg-gold/10 disabled:opacity-30"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 5: Equipment ─────────────────────────────────── */}
          {step === 5 && (
            <div data-testid="wizard-step-5">
              <p className="font-cormorant italic text-parchment-muted text-sm mb-3">
                Suggested starting kit for <b className="text-gold not-italic">{className || "your class"}</b>.
                Toggle anything you don&apos;t want, or add custom gear once inside the sheet.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {equipment.length === 0 && (
                  <p className="font-cormorant italic text-parchment-dim text-sm">
                    No starting gear configured — you can add items in the sheet.
                  </p>
                )}
                {equipment.map((it, i) => (
                  <label
                    key={it.label}
                    className="flex items-center gap-2 border border-edge bg-ink/40 px-3 py-2 cursor-pointer hover:border-gold/40"
                    data-testid={`wizard-equip-${i}`}
                  >
                    <input
                      type="checkbox"
                      checked={it.checked}
                      onChange={(e) =>
                        setEquipment((prev) =>
                          prev.map((p, idx) => (idx === i ? { ...p, checked: e.target.checked } : p))
                        )
                      }
                      data-testid={`wizard-equip-${i}-check`}
                    />
                    <span className="font-cormorant text-parchment text-sm">{it.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-4 border-t border-edge flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onClose()}
            disabled={submitting}
            data-testid="wizard-cancel"
            className="font-cinzel text-[10px] tracking-[0.25em] uppercase text-parchment-muted hover:text-parchment disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={submitting}
                data-testid="wizard-back"
                className="px-4 py-2 border border-edge text-parchment-muted hover:text-parchment hover:border-parchment-muted font-cinzel text-[10px] tracking-[0.2em] uppercase btn-press disabled:opacity-50"
              >
                ← Back
              </button>
            )}
            {step < TOTAL_STEPS && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
                disabled={!canNext || submitting}
                data-testid="wizard-next"
                className="px-5 py-2 bg-crimson hover:bg-crimson-dark text-parchment font-cinzel text-[10px] tracking-[0.2em] uppercase border border-edge btn-press disabled:opacity-50"
              >
                Next →
              </button>
            )}
            {step === TOTAL_STEPS && (
              <button
                type="button"
                onClick={finish}
                disabled={submitting}
                data-testid="wizard-finish"
                className="px-5 py-2 bg-crimson hover:bg-crimson-dark text-parchment font-cinzel text-[10px] tracking-[0.2em] uppercase border border-edge btn-press disabled:opacity-50"
              >
                {submitting ? "Forging…" : "✦ Create Hero"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
