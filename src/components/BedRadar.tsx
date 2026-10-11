import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import {
  Activity, ArrowDownUp, BedDouble, Building2, ChevronDown, Crosshair, ExternalLink, Info, LocateFixed,
  MapPin, Moon, Navigation, Search, Star, Sun, Trophy, X, AlertTriangle, MousePointerClick,
} from "lucide-react";
import {
  directionsUrl, formatFee, formatKm, formatNum, parseHospitalsCsv, rankHospitals, validCoords,
  type Hospital, type LatLng, type Mode, type RankedHospital, type Status,
} from "@/lib/hospitals";
import { LANGS, t, type Lang } from "@/lib/i18n";
import { Languages, CalendarDays } from "lucide-react";

const HospitalMap = lazy(() => import("./HospitalMap"));

const DEFAULT_LOC: LatLng = { lat: 20.2961, lng: 85.8245 };
const AREAS: { name: string; loc: LatLng }[] = [
  { name: "Bhubaneswar city centre", loc: DEFAULT_LOC },
  { name: "Patia", loc: { lat: 20.3537, lng: 85.8193 } },
  { name: "Saheed Nagar", loc: { lat: 20.2905, lng: 85.8446 } },
  { name: "Khandagiri", loc: { lat: 20.2557, lng: 85.7795 } },
  { name: "Chandrasekharpur", loc: { lat: 20.3247, lng: 85.8197 } },
  { name: "Old Town", loc: { lat: 20.2386, lng: 85.8336 } },
  { name: "Nayapalli", loc: { lat: 20.2938, lng: 85.8105 } },
];
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "recommended", label: "Recommended", hint: "Balances fee, distance and rating" },
  { id: "nearest", label: "Nearest", hint: "Shortest straight-line distance" },
  { id: "cheapest", label: "Cheapest", hint: "Lowest admission fee" },
  { id: "rated", label: "Best rated", hint: "Highest rating" },
];

type LocSource = "default" | "gps" | "manual" | "map" | "area";
interface Filters { q: string; type: string; minRating: number; maxFee: string; status: string; maxKm: string; recOnly: boolean }
const EMPTY_FILTERS: Filters = { q: "", type: "all", minRating: 0, maxFee: "", status: "all", maxKm: "", recOnly: false };

const statusStyle: Record<Status, string> = {
  Available: "bg-available-soft text-available border-available/40",
  Limited: "bg-limited-soft text-limited border-limited/40",
  Full: "bg-full-soft text-full border-full/40",
  Unknown: "bg-muted text-muted-foreground border-border",
};
const barStyle: Record<Status, string> = { Available: "bg-available", Limited: "bg-limited", Full: "bg-full", Unknown: "bg-muted-foreground" };
const statusIcon: Record<Status, string> = { Available: "●", Limited: "◐", Full: "○", Unknown: "?" };

function StatusBadge({ s, lang }: { s: Status; lang: Lang }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyle[s]}`}>
      <span aria-hidden>{statusIcon[s]}</span>{t(lang, s)}
    </span>
  );
}
const card = "rounded-2xl border border-border bg-card shadow-card";
const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
const btnGhost = `${btn} border border-border bg-card text-foreground hover:bg-accent`;
const btnLocate = `${btn} bg-locate text-primary-foreground hover:bg-locate/90`;
const input = "w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function BedRadar() {
  const [raw, setRaw] = useState<Hospital[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingCols, setMissingCols] = useState<string[]>([]);
  const [user, setUser] = useState<LatLng>(DEFAULT_LOC);
  const [source, setSource] = useState<LocSource>("default");
  const [locMsg, setLocMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [manual, setManual] = useState({ lat: String(DEFAULT_LOC.lat), lng: String(DEFAULT_LOC.lng) });
  const [mode, setMode] = useState<Mode>("recommended");
  const [topN, setTopN] = useState(5);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [dark, setDark] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [today, setToday] = useState("");
  useEffect(() => { const loc = LANGS.find((l) => l.id === lang)!.locale; setToday(new Date().toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" })); document.documentElement.lang = lang; }, [lang]);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [sortKey, setSortKey] = useState<"rank" | "distance" | "fee" | "rating" | "beds">("rank");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetch("/hospitals.csv")
      .then((r) => { if (!r.ok) throw new Error(`Could not load hospitals.csv (HTTP ${r.status}).`); return r.text(); })
      .then((t) => { const res = parseHospitalsCsv(t); setRaw(res.hospitals); setMissingCols(res.missing); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  const ranked = useMemo(() => (raw ? rankHospitals(raw, user, mode) : []), [raw, user, mode]);
  const maxN = Math.max(1, ranked.length);
  useEffect(() => { if (topN > maxN) setTopN(maxN); }, [maxN, topN]);
  const types = useMemo(() => Array.from(new Set(ranked.map((h) => h.type).filter(Boolean))) as string[], [ranked]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const maxFee = filters.maxFee === "" ? null : Number(filters.maxFee);
    const maxKm = filters.maxKm === "" ? null : Number(filters.maxKm);
    return ranked.filter((h) =>
      (!q || h.name.toLowerCase().includes(q) || (h.address ?? "").toLowerCase().includes(q)) &&
      (filters.type === "all" || h.type === filters.type) &&
      (filters.minRating === 0 || (h.rating ?? -1) >= filters.minRating) &&
      (maxFee === null || (h.fee !== null && h.fee <= maxFee)) &&
      (filters.status === "all" || h.status === filters.status) &&
      (maxKm === null || (h.distance !== null && h.distance <= maxKm)) &&
      (!filters.recOnly || h.rank <= topN));
  }, [ranked, filters, topN]);

  const tableRows = useMemo(() => {
    const val = (h: RankedHospital) => ({ rank: h.rank, distance: h.distance, fee: h.fee, rating: h.rating, beds: h.availableBeds })[sortKey];
    return [...ranked].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return a.rank - b.rank;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (sortAsc ? va - vb : vb - va) || a.rank - b.rank;
    });
  }, [ranked, sortKey, sortAsc]);

  const stats = useMemo(() => ({
    total: ranked.length,
    beds: ranked.reduce((s, h) => s + (h.availableBeds ?? 0), 0),
    withBeds: ranked.filter((h) => (h.availableBeds ?? 0) > 0).length,
    rec: Math.min(topN, ranked.length),
  }), [ranked, topN]);

  const origin = source === "default" ? null : user;
  const selected = ranked.find((h) => h.id === selectedId) ?? null;
  const selDir = selected ? directionsUrl(selected, origin) : null;
  const detail = ranked.find((h) => h.id === detailId) ?? null;
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function moveUser(p: LatLng, src: LocSource, msg?: string) {
    setUser(p); setSource(src);
    setManual({ lat: p.lat.toFixed(5), lng: p.lng.toFixed(5) });
    setLocMsg(msg ? { kind: "ok", text: msg } : null);
    setPickMode(false);
  }
  function useGps() {
    if (!("geolocation" in navigator)) { setLocMsg({ kind: "err", text: "Your browser does not support location access. Enter coordinates, pick an area, or click the map instead." }); return; }
    setLocMsg({ kind: "ok", text: "Requesting your location…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => moveUser({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "gps", `Location found (±${Math.round(pos.coords.accuracy)} m).`),
      (err) => setLocMsg({ kind: "err", text: err.code === 1 ? "Location permission was denied. You can still enter coordinates, choose an area, or pick on the map." : "Could not get your location. Please try again or set it manually." }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  function applyManual() {
    const lat = Number(manual.lat), lng = Number(manual.lng);
    if (manual.lat.trim() === "" || manual.lng.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || !validCoords(lat, lng)) {
      setLocMsg({ kind: "err", text: "Enter a latitude between −90 and 90 and a longitude between −180 and 180." }); return;
    }
    moveUser({ lat, lng }, "manual", "Location updated from coordinates.");
  }
  function select(id: string) { setSelectedId(id); document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function openDetails(id: string) { setSelectedId(id); setDetailId(id); }
  function toggleSort(k: typeof sortKey) { if (k === sortKey) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(k !== "rating" && k !== "beds"); } }

  if (error) return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className={`${card} max-w-md p-6 text-center`}>
        <AlertTriangle className="mx-auto mb-3 text-full" />
        <h1 className="text-xl font-bold">Hospital data couldn't be loaded</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error} No substitute data is shown.</p>
      </div>
    </main>
  );
  if (!raw) return <main className="grid min-h-screen place-items-center text-muted-foreground">{tr("loading")}</main>;


  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="border-b border-border bg-muted">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs sm:px-6">
            <span className="flex items-center gap-1.5 font-semibold"><CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden />{today}</span>
            <div className="flex items-center gap-1" role="group" aria-label="Language">
              <Languages className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {LANGS.map((l) => <button key={l.id} onClick={() => setLang(l.id)} aria-pressed={lang === l.id} className={`rounded-md px-2 py-0.5 font-semibold ${lang === l.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{l.label}</button>)}
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Activity /></div>
            <div>
              <h1 className="text-2xl font-extrabold text-foreground">BedRadar</h1>
              <p className="text-sm text-muted-foreground">{tr("subtitle")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { k: tr("hospitals"), v: stats.total, i: Building2 },
              { k: tr("bedsFree"), v: formatNum(stats.beds), i: BedDouble },
              { k: tr("withBeds"), v: stats.withBeds, i: Activity },
              { k: tr("recommended"), v: stats.rec, i: Trophy },
            ].map(({ k, v, i: I }) => (
              <div key={k} className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
                <I className="h-4 w-4 text-primary" aria-hidden />
                <div><div className="text-base font-bold leading-none">{v}</div><div className="text-[11px] text-muted-foreground">{k}</div></div>
              </div>
            ))}
            <button className={btnGhost} onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          </div>
        </div>
        <div className="border-t border-border bg-limited-soft">
          <p className="mx-auto flex max-w-[1440px] items-start gap-2 px-4 py-2 text-xs text-foreground sm:px-6"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{tr("disclaimer")}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          {/* Left column */}
          <div className="space-y-6">
            <section className={`${card} p-5`} aria-labelledby="loc-h">
              <h2 id="loc-h" className="mb-1 flex items-center gap-2 text-lg font-bold"><MapPin className="h-5 w-5 text-locate" />{tr("yourLocation")}</h2>
<div className="mb-4" />
              <div className="grid grid-cols-2 gap-2">
                <button className={btnLocate} onClick={useGps}><LocateFixed className="h-4 w-4" />{tr("useMyLocation")}</button>
                <button className={pickMode ? btnPrimary : btnGhost} onClick={() => setPickMode(!pickMode)} aria-pressed={pickMode}><MousePointerClick className="h-4 w-4" />{pickMode ? tr("clickMap") : tr("pickOnMap")}</button>
              </div>
              <div className="mt-4">
                <label className={label} htmlFor="area">{tr("area")}</label>
                <select id="area" className={input} defaultValue="" onChange={(e) => { const a = AREAS.find((x) => x.name === e.target.value); if (a) moveUser(a.loc, "area", `Moved to ${a.name} (approximate centre).`); }}>
                  <option value="" disabled>{tr("chooseArea")}</option>
                  {AREAS.map((a) => <option key={a.name}>{a.name}</option>)}
                </select>
              </div>
              <form className="mt-4 grid grid-cols-[1fr_1fr_auto] items-end gap-2" onSubmit={(e) => { e.preventDefault(); applyManual(); }}>
                <div><label className={label} htmlFor="lat">{tr("latitude")}</label><input id="lat" className={input} inputMode="decimal" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} /></div>
                <div><label className={label} htmlFor="lng">{tr("longitude")}</label><input id="lng" className={input} inputMode="decimal" value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} /></div>
                <button type="submit" className={btnGhost}><Crosshair className="h-4 w-4" />{tr("set")}</button>
              </form>
              {locMsg && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs ${locMsg.kind === "err" ? "bg-full-soft text-full" : "bg-available-soft text-foreground"}`}>{locMsg.text}</p>}
              <p className="mt-3 text-xs text-muted-foreground">{tr("dragTip")}</p>
            </section>

            <section className={`${card} p-5`} aria-labelledby="rank-h">
              <h2 id="rank-h" className="mb-4 flex items-center gap-2 text-lg font-bold"><Trophy className="h-5 w-5 text-primary" />{tr("findBest")}</h2>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ranking mode">
                {MODES.map((m) => (
                  <button key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${mode === m.id ? "border-primary bg-accent" : "border-border hover:bg-muted"}`}>
                    <div className="text-sm font-bold">{m.label}</div><div className="text-[11px] text-muted-foreground">{m.hint}</div>
                  </button>
                ))}
              </div>
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-sm"><label htmlFor="topn" className="font-semibold">{tr("highlight")}</label><span className="font-bold text-primary">{tr("top")} {topN} hospital{topN > 1 ? "s" : ""}</span></div>
                <input id="topn" type="range" min={1} max={maxN} value={Math.min(topN, maxN)} onChange={(e) => setTopN(Number(e.target.value))} className="w-full" />
                <div className="flex justify-between text-[11px] text-muted-foreground"><span>1</span><span>{maxN}</span></div>
              </div>
            </section>
          </div>

          {/* Map */}
          <section className={`${card} flex min-h-[520px] flex-col overflow-hidden`} aria-label="Hospital map">
            <div className="relative flex-1">
              <ClientOnly fallback={<div className="grid h-full place-items-center text-muted-foreground">Loading map…</div>}>
                <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">Loading map…</div>}>
                  <div className="absolute inset-0">
                    <HospitalMap hospitals={ranked} user={user} topN={topN} selectedId={selectedId} pickMode={pickMode}
                      onSelect={select} onDetails={openDetails} origin={origin} onUserMove={(p) => moveUser(p, "map", "Location set on the map.")} />
                  </div>
                </Suspense>
              </ClientOnly>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs">
              <span className="font-semibold">{tr("legend")}</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-locate" />{tr("you")}</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-available" />{tr("Available")}</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-limited" />{tr("Limited")}</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-full" />{tr("Full")}</span>
              <span className="flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">1</i>Numbered = Top {topN}</span>
              <span className="text-muted-foreground">Rings: 2 / 5 / 10 km</span>
            </div>
          </section>
        </div>

        {/* Filters + cards */}
        <section aria-labelledby="list-h" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="list-h" className="text-xl font-bold">{tr("hospitals")} <span className="text-sm font-medium text-muted-foreground">· {filtered.length} {tr("of")} {ranked.length} {tr("shown")}</span></h2>
            {filtersActive && <button className={btnGhost} onClick={() => setFilters(EMPTY_FILTERS)}><X className="h-4 w-4" />{tr("clearFilters")}</button>}
          </div>
          <div className={`${card} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7`}>
            <div className="relative sm:col-span-2">
              <label className={label} htmlFor="q">{tr("search")}</label>
              <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-muted-foreground" />
              <input id="q" className={`${input} pl-9`} placeholder="Name or address" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            </div>
            <div><label className={label} htmlFor="ft">Type</label>
              <select id="ft" className={input} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                <option value="all">All types</option>{types.map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div><label className={label} htmlFor="fr">Min rating</label>
              <select id="fr" className={input} value={filters.minRating} onChange={(e) => setFilters({ ...filters, minRating: Number(e.target.value) })}>
                {[0, 3, 3.5, 4, 4.5].map((r) => <option key={r} value={r}>{r === 0 ? "Any" : `${r}+ ★`}</option>)}
              </select></div>
            <div><label className={label} htmlFor="ff">Max fee (₹)</label><input id="ff" type="number" min={0} className={input} placeholder="Any" value={filters.maxFee} onChange={(e) => setFilters({ ...filters, maxFee: e.target.value })} /></div>
            <div><label className={label} htmlFor="fs">Availability</label>
              <select id="fs" className={input} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="all">All</option><option>Available</option><option>Limited</option><option>Full</option>
              </select></div>
            <div><label className={label} htmlFor="fd">Within (km)</label><input id="fd" type="number" min={0} className={input} placeholder="Any" value={filters.maxKm} onChange={(e) => setFilters({ ...filters, maxKm: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2 lg:col-span-7">
              <input type="checkbox" checked={filters.recOnly} onChange={(e) => setFilters({ ...filters, recOnly: e.target.checked })} className="h-4 w-4 accent-primary" />Recommended (Top {topN}) only
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className={`${card} p-10 text-center`}>
              <Search className="mx-auto mb-2 text-muted-foreground" />
              <p className="font-semibold">{tr("noMatch")}</p>
              <button className={`${btnPrimary} mt-4`} onClick={() => setFilters(EMPTY_FILTERS)}>{tr("clearFilters")}</button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((h) => <HospitalCard key={h.id} h={h} rec={h.rank <= topN} selected={h.id === selectedId} origin={origin} lang={lang}
                onSelect={() => setSelectedId(h.id)} onDetails={() => openDetails(h.id)} />)}
            </div>
          )}
        </section>

        {/* Table */}
        <section aria-labelledby="cmp-h" className={`${card} overflow-hidden`}>
          <div className="p-5 pb-3"><h2 id="cmp-h" className="text-xl font-bold">{tr("compareAll")}</h2>
            <p className="text-xs text-muted-foreground">Every hospital in the dataset. Click a column with <ArrowDownUp className="inline h-3 w-3" /> to sort; click a row to select it on the map.</p></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {([["rank", "Rank"], [null, "Hospital"], [null, "Type"], ["distance", "Distance"], ["fee", "Fee"], ["rating", "Rating"], [null, "Reviews"], [null, "Total"], ["beds", "Free beds"], [null, "Occupancy"], [null, "Status"], [null, "Website"], [null, "Directions"]] as const).map(([k, l]) => (
                    <th key={l} className="px-3 py-2.5 font-semibold" aria-sort={k && sortKey === k ? (sortAsc ? "ascending" : "descending") : undefined}>
                      {k ? <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>{l}<ArrowDownUp className="h-3 w-3" /></button> : l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((h) => {
                  const rec = h.rank <= topN; const d = directionsUrl(h, origin);
                  return (
                    <tr key={h.id} onClick={() => setSelectedId(h.id)} className={`cursor-pointer border-t border-border ${h.id === selectedId ? "bg-locate-soft" : rec ? "bg-accent/50" : "hover:bg-muted"}`}>
                      <td className="px-3 py-2.5 font-bold">#{h.rank}{rec && <span className="ml-1 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">Rec</span>}</td>
                      <td className="max-w-[260px] px-3 py-2.5"><button className="text-left font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); openDetails(h.id); }}>{h.name}</button><div className="text-xs text-muted-foreground">{h.address}</div></td>
                      <td className="px-3 py-2.5">{h.type ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatKm(h.distance)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{h.fee === 0 ? "₹0" : formatFee(h.fee)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{h.rating ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatNum(h.reviews)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatNum(h.totalBeds)}</td>
                      <td className="px-3 py-2.5 font-semibold tabular-nums">{formatNum(h.availableBeds)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{h.occupancy !== null ? `${h.occupancy}%` : "—"}</td>
                      <td className="px-3 py-2.5"><StatusBadge lang={lang} s={h.status} /></td>
                      <td className="px-3 py-2.5">{h.website ? <a href={h.website} target="_blank" rel="noreferrer" className="text-locate underline" onClick={(e) => e.stopPropagation()}>Visit</a> : <span className="text-muted-foreground">Not listed</span>}</td>
                      <td className="px-3 py-2.5">{d ? <a href={d} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-locate" onClick={(e) => e.stopPropagation()}><Navigation className="h-3.5 w-3.5" />Go</a> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <HowItWorks lang={lang} />
      </main>
      <footer className="px-6 pb-24 text-center text-xs text-muted-foreground">BedRadar · Data from hospitals.csv · Map © OpenStreetMap contributors · Not a medical service.</footer>

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-[1500] border-t border-border bg-card shadow-card">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1"><div className="text-[11px] uppercase text-muted-foreground">{tr("selected")} · #{selected.rank}</div><div className="truncate font-bold">{selected.name} · {formatKm(selected.distance)}</div></div>
            {selDir && <a href={selDir} target="_blank" rel="noreferrer" className={btnLocate}><Navigation className="h-4 w-4" />{tr("directions")}</a>}
            <button className={btnGhost} onClick={() => setDetailId(selected.id)}>{tr("viewDetails")}</button>
            <button className={btnGhost} onClick={() => setSelectedId(null)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {detail && <DetailsPanel h={detail} rec={detail.rank <= topN} mode={mode} origin={origin} lang={lang} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function HospitalCard({ h, rec, selected, origin, lang, onSelect, onDetails }: { lang: Lang; h: RankedHospital; rec: boolean; selected: boolean; origin: LatLng | null; onSelect: () => void; onDetails: () => void }) {
  const d = directionsUrl(h, origin);
  const pct = h.totalBeds && h.availableBeds !== null ? Math.min(100, (h.availableBeds / h.totalBeds) * 100) : 0;
  return (
    <article id={`card-${h.id}`} onClick={onSelect}
      className={`${card} flex cursor-pointer flex-col p-4 transition-shadow hover:shadow-lg ${selected ? "ring-2 ring-locate" : rec ? "ring-1 ring-primary/50" : ""}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold ${rec ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{h.rank}</span>
          {rec && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">Recommended</span>}
          {h.type && <span className="text-xs text-muted-foreground">{h.type}</span>}
        </div>
        <StatusBadge lang={lang} s={h.status} />
      </div>
      <h3 className="text-base font-bold leading-snug">{h.name}</h3>
      {h.address && <p className="mt-0.5 text-xs text-muted-foreground">{h.address}</p>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted p-2"><dt className="text-[10px] uppercase text-muted-foreground">Distance</dt><dd className="text-sm font-bold">{formatKm(h.distance)}</dd></div>
        <div className="rounded-lg bg-muted p-2"><dt className="text-[10px] uppercase text-muted-foreground">Admission</dt><dd className="text-sm font-bold">{h.fee === 0 ? "Free" : formatFee(h.fee)}</dd></div>
        <div className="rounded-lg bg-muted p-2"><dt className="text-[10px] uppercase text-muted-foreground">Rating</dt><dd className="flex items-center justify-center gap-1 text-sm font-bold"><Star className="h-3.5 w-3.5 fill-limited text-limited" />{h.rating ?? "—"}</dd><dd className="text-[10px] text-muted-foreground">{h.reviews !== null ? `${formatNum(h.reviews)} reviews` : ""}</dd></div>
      </dl>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs"><span><strong>{formatNum(h.availableBeds)}</strong> / {formatNum(h.totalBeds)} general-ward beds free</span>{h.occupancy !== null && <span className="text-muted-foreground">{h.occupancy}% occupied</span>}</div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of beds available"><div className={`h-full ${barStyle[h.status]}`} style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={`${btnGhost} flex-1`} onClick={(e) => { e.stopPropagation(); onDetails(); }}>{t(lang, "viewDetails")}</button>
        {d && <a href={d} target="_blank" rel="noreferrer" className={`${btnLocate} flex-1`} onClick={(e) => e.stopPropagation()}><Navigation className="h-4 w-4" />{t(lang, "directions")}</a>}
        {h.website && <a href={h.website} target="_blank" rel="noreferrer" className={btnGhost} onClick={(e) => e.stopPropagation()} aria-label="Website"><ExternalLink className="h-4 w-4" /></a>}
      </div>
    </article>
  );
}

function DetailsPanel({ h, rec, mode, origin, lang, onClose }: { lang: Lang; h: RankedHospital; rec: boolean; mode: Mode; origin: LatLng | null; onClose: () => void }) {
  const d = directionsUrl(h, origin);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const rows: [string, string][] = [
    ["Type", h.type ?? "—"], ["Address", h.address ?? "—"], ["Distance (calculated)", formatKm(h.distance)], ["Admission fee", formatFee(h.fee)],
    ["Rating", h.rating !== null ? `${h.rating} / 5` : "—"], ["Reviews", formatNum(h.reviews)], ["Total general-ward beds", formatNum(h.totalBeds)],
    ["Available beds", formatNum(h.availableBeds)], ["Occupancy", h.occupancy !== null ? `${h.occupancy}%` : "—"],
    [`Rank (${MODES.find((m) => m.id === mode)!.label})`, `#${h.rank}${rec ? " · Recommended" : ""}`],
    ["Recommended score (calculated)", h.score !== null ? formatNum(Math.round(h.score * 100) / 100) : "—"],
    ["Coordinates", h.hasValidCoords ? `${h.lat}, ${h.lng}` : "Invalid / missing"], ["Hospital ID", h.id],
  ];
  return (
    <div className="fixed inset-0 z-[2000] flex justify-end bg-foreground/30" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="dlg-h" className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><StatusBadge lang={lang} s={h.status} /><h2 id="dlg-h" className="mt-2 text-2xl font-bold">{h.name}</h2></div>
          <button className={btnGhost} onClick={onClose} aria-label="Close" autoFocus><X className="h-4 w-4" /></button>
        </div>
        <dl className="divide-y divide-border text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}
        </dl>
        <p className="mt-4 rounded-lg bg-limited-soft p-3 text-xs">{t(lang, "disclaimer")}</p>
        <div className="mt-4 grid gap-2">
          {d && <a href={d} target="_blank" rel="noreferrer" className={btnLocate}><Navigation className="h-4 w-4" />{t(lang, "getDirections")}</a>}
          {h.website ? <a href={h.website} target="_blank" rel="noreferrer" className={btnGhost}><ExternalLink className="h-4 w-4" />Hospital website</a> : <p className="text-center text-xs text-muted-foreground">No website listed in the dataset.</p>}
          <button className={btnGhost} onClick={onClose}>{t(lang, "back")}</button>
        </div>
      </aside>
    </div>
  );
}

function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <details className={`${card} group p-5`}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-xl font-bold">{t(lang, "howWorks")}<ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" /></summary>
      <div className="mt-4 grid gap-6 text-sm lg:grid-cols-2">
        <ol className="list-decimal space-y-2 pl-5">
          <li>BedRadar reads hospital records from <code>hospitals.csv</code> when the page opens.</li>
          <li>You choose a location: GPS, coordinates, an area, a map click, or by dragging the blue marker.</li>
          <li>Straight-line distance to each hospital is calculated with the Haversine formula (not road distance).</li>
          <li>Hospitals are ranked by the selected mode. Hospitals with zero free beds are always placed last but stay visible.</li>
          <li>The Top-N slider decides how many top-ranked hospitals get the “Recommended” highlight.</li>
          <li>Availability labels come from bed counts and occupancy: <b>Full</b> = 0 beds; <b>Limited</b> = occupancy ≥ 90% or ≤ 10 beds; <b>Available</b> otherwise.</li>
          <li>You can compare and select any hospital, not only the recommended ones.</li>
        </ol>
        <div className="space-y-3">
          <div className="rounded-xl bg-muted p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Recommended-mode formula</div>
            <p className="mt-2 text-xs text-muted-foreground">Higher is better; ties go to the closer hospital. The terms use different units (rupees, kilometres, stars), so fee and rating dominate while distance has a small effect. This is a simple heuristic — not a medically validated measure and no guarantee of the best clinical outcome.</p>
          </div>

        </div>
      </div>
    </details>
  );
}
