import { useEffect, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { x, d, type Lang } from "@/lib/i18n";
import { directionsUrl, formatFee, formatKm, type LatLng, type RankedHospital } from "@/lib/hospitals";

interface Props {
  hospitals: RankedHospital[];
  user: LatLng;
  topN: number;
  selectedId: string | null;
  pickMode: boolean;
  onSelect: (id: string) => void;
  onDetails: (id: string) => void;
  onUserMove: (p: LatLng) => void;
  origin: LatLng | null;
  lang: Lang;
}

const userIcon = L.divIcon({ className: "", html: '<div class="br-user"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });

function hospIcon(h: RankedHospital, rec: boolean, sel: boolean) {
  const cls = `br-pin br-${h.status.toLowerCase()} ${rec ? "br-rec" : ""} ${sel ? "br-sel" : ""}`;
  const label = rec ? d(h.rank) : "";
  const size = rec ? 30 : 18;
  return L.divIcon({ className: "", html: `<div class="${cls}">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function Controller({ hospitals, user, selectedId, pickMode, onUserMove }: Props) {
  const map = useMap();
  useMapEvents({ click: (e) => pickMode && onUserMove({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  useEffect(() => {
    const pts = hospitals.filter((h) => h.hasValidCoords).map((h) => [h.lat!, h.lng!] as [number, number]);
    pts.push([user.lat, user.lng]);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.lat, user.lng, hospitals.length]);
  useEffect(() => {
    const h = hospitals.find((x) => x.id === selectedId);
    if (h?.hasValidCoords) map.panTo([h.lat!, h.lng!]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  useEffect(() => {
    map.getContainer().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode, map]);
  return null;
}

export default function HospitalMap(props: Props) {
  const { hospitals, user, topN, selectedId, onSelect, onDetails, onUserMove, origin, lang } = props;
  const plotted = useMemo(() => hospitals.filter((h) => h.hasValidCoords), [hospitals]);
  return (
    <MapContainer center={[user.lat, user.lng]} zoom={12} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Controller {...props} />
      {[2, 5, 10].map((km) => (
        <Circle key={km} center={[user.lat, user.lng]} radius={km * 1000} pathOptions={{ className: "br-ring", fill: false, weight: 1, dashArray: "2 6" }} />
      ))}
      {plotted
        .filter((h) => h.rank <= topN)
        .map((h) => (
          <Polyline key={`l-${h.id}`} positions={[[user.lat, user.lng], [h.lat!, h.lng!]]} pathOptions={{ className: "br-line", weight: 1.5, dashArray: "5 6" }} />
        ))}
      {plotted
        .slice()
        .sort((a, b) => b.rank - a.rank)
        .map((h) => {
          const rec = h.rank <= topN;
          return (
            <Marker
              key={`${h.id}-${lang}`}
              position={[h.lat!, h.lng!]}
              icon={hospIcon(h, rec, h.id === selectedId)}
              zIndexOffset={h.id === selectedId ? 2000 : rec ? 1000 : 0}
              eventHandlers={{ click: () => onSelect(h.id) }}
            >
              <Popup>
                <div className="br-popup">
                  <strong>#{d(h.rank)} · {x(h.name)}</strong>
                  <div>{formatKm(h.distance)} · {formatFee(h.fee)}</div>
                  <div>★ {h.rating !== null ? d(h.rating) : "—"} · {h.availableBeds !== null ? d(h.availableBeds) : "—"} {x("beds free")} ({x(h.status)})</div>
                  <button type="button" onClick={() => onDetails(h.id)}>{x("View details")}</button>
                  {directionsUrl(h, origin) && <a className="br-dir" href={directionsUrl(h, origin)!} target="_blank" rel="noreferrer">{x("Get directions ↗")}</a>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      <Marker
        position={[user.lat, user.lng]}
        icon={userIcon}
        draggable
        zIndexOffset={3000}
        eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onUserMove({ lat: p.lat, lng: p.lng }); } }}
      >
        <Popup>{x("Your location (drag to move)")}</Popup>
      </Marker>
    </MapContainer>
  );
}
