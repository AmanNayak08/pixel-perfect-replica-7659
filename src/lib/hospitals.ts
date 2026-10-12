import Papa from "papaparse";
import { d, x } from "./i18n";

export interface Hospital {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  totalBeds: number | null;
  availableBeds: number | null;
  occupancy: number | null;
  fee: number | null;
  rating: number | null;
  reviews: number | null;
  website: string | null;
}

export type Status = "Available" | "Limited" | "Full" | "Unknown";
export type Mode = "recommended" | "nearest" | "cheapest" | "rated";
export interface LatLng {
  lat: number;
  lng: number;
}

export interface RankedHospital extends Hospital {
  distance: number | null;
  score: number | null;
  rank: number;
  status: Status;
  hasValidCoords: boolean;
}

const ALIASES: Record<keyof Hospital, string[]> = {
  id: ["hospital_id", "id"],
  name: ["hospital_name", "name", "hospital"],
  type: ["hospital_type", "type", "ownership"],
  address: ["address", "location", "area"],
  lat: ["latitude", "lat"],
  lng: ["longitude", "lng", "lon", "long"],
  totalBeds: ["general_ward_total_beds", "total_beds", "beds_total"],
  availableBeds: ["general_ward_available_beds", "available_beds", "beds_available"],
  occupancy: ["general_ward_occupancy_pct", "occupancy_pct", "occupancy"],
  fee: ["admission_fee_inr", "admission_fee", "fee"],
  rating: ["rating_5", "rating"],
  reviews: ["review_count", "reviews"],
  website: ["website", "url", "website_url"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[₹,\s%]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

export interface ParseResult {
  hospitals: Hospital[];
  columns: string[];
  missing: string[];
}

export function parseHospitalsCsv(text: string): ParseResult {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headers = (res.meta.fields ?? []).map((h) => h);
  const map: Partial<Record<keyof Hospital, string>> = {};
  (Object.keys(ALIASES) as (keyof Hospital)[]).forEach((key) => {
    const h = headers.find((x) => ALIASES[key].includes(norm(x)));
    if (h) map[key] = h;
  });
  if (!map.name) throw new Error("The CSV has no hospital name column.");
  const get = (row: Record<string, string>, k: keyof Hospital) => (map[k] ? row[map[k]!] : undefined);
  const hospitals: Hospital[] = res.data
    .map((row, i) => {
      const lat = num(get(row, "lat"));
      const lng = num(get(row, "lng"));
      const web = str(get(row, "website"));
      return {
        id: str(get(row, "id")) ?? `row-${i + 1}`,
        name: str(get(row, "name")) ?? "",
        type: str(get(row, "type")),
        address: str(get(row, "address")),
        lat,
        lng,
        totalBeds: num(get(row, "totalBeds")),
        availableBeds: num(get(row, "availableBeds")),
        occupancy: num(get(row, "occupancy")),
        fee: num(get(row, "fee")),
        rating: num(get(row, "rating")),
        reviews: num(get(row, "reviews")),
        website: web && /^https?:\/\//i.test(web) ? web : null,
      };
    })
    .filter((h) => h.name);
  if (!hospitals.length) throw new Error("The CSV contains no usable hospital rows.");
  const missing = (Object.keys(ALIASES) as (keyof Hospital)[]).filter((k) => !map[k]);
  return { hospitals, columns: headers, missing };
}

export const validCoords = (lat: number | null, lng: number | null) =>
  lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function classifyStatus(h: Hospital): Status {
  if (h.availableBeds === null) return "Unknown";
  if (h.availableBeds <= 0) return "Full";
  if ((h.occupancy !== null && h.occupancy >= 90) || h.availableBeds <= 10) return "Limited";
  return "Available";
}

/**
 * Score = A×1000 + X/1000 − Y×100 − Z/10
 * A = availability % (100 − occupancy %), X = rating × review count,
 * Y = distance in km, Z = admission fee in ₹.
 */
export function recommendedScore(h: Hospital, distance: number | null) {
  if (h.occupancy === null || h.rating === null || h.reviews === null || distance === null || h.fee === null) return null;
  const A = 100 - h.occupancy;
  const X = h.rating * h.reviews;
  return A * 1000 + X / 1000 - distance * 100 - h.fee / 10;
}

export function rankHospitals(list: Hospital[], user: LatLng | null, mode: Mode): RankedHospital[] {
  const enriched = list.map((h) => {
    const ok = validCoords(h.lat, h.lng);
    const distance = ok && user ? haversineKm(user, { lat: h.lat!, lng: h.lng! }) : null;
    return {
      ...h,
      hasValidCoords: ok,
      distance,
      score: recommendedScore(h, distance),
      status: classifyStatus(h),
      rank: 0,
    };
  });
  // nulls last helper; asc=true means lower first
  const cmp = (a: number | null, b: number | null, asc: boolean) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return asc ? a - b : b - a;
  };
  const primary = (a: RankedHospital, b: RankedHospital) => {
    switch (mode) {
      case "nearest":
        return cmp(a.distance, b.distance, true);
      case "cheapest":
        return cmp(a.fee, b.fee, true);
      case "rated":
        return cmp(a.rating, b.rating, false);
      default:
        return cmp(a.score, b.score, false);
    }
  };
  enriched.sort((a, b) => {
    const fa = a.status === "Full" ? 1 : 0;
    const fb = b.status === "Full" ? 1 : 0;
    if (fa !== fb) return fa - fb;
    return (
      primary(a, b) || cmp(a.distance, b.distance, true) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
  });
  enriched.forEach((h, i) => (h.rank = i + 1));
  return enriched;
}

export function directionsUrl(h: Hospital, origin: LatLng | null): string | null {
  if (!validCoords(h.lat, h.lng)) return null;
  const p = new URLSearchParams({ api: "1", destination: `${h.lat},${h.lng}`, travelmode: "driving" });
  if (origin && validCoords(origin.lat, origin.lng)) p.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

const inr = new Intl.NumberFormat("en-IN");
export const formatFee = (fee: number | null) =>
  fee === null ? x("Not listed") : fee === 0 ? d(`₹0 (${x("free admission")})`) : d(`₹${inr.format(fee)}`);
export const formatNum = (n: number | null) => (n === null ? "—" : d(inr.format(n)));
export const formatKm = (km: number | null) =>
  km === null ? "—" : km < 1 ? d(`${Math.round(km * 1000)} ${x("m")}`) : d(`${km.toFixed(1)} ${x("km")}`);
