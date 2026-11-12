import { activeRegions, regionOf } from "./regions.js";
import { loadRegion } from "./dataSource.js";

const $ = (id) => document.getElementById(id);
const DEFAULT = activeRegions()[0];
const WALK_M_PER_MIN = 75; // 보통 걸음 약 4.5km/h

// ── 지도 ───────────────────────────────────────────
const [s, w, n, e] = DEFAULT.bounds;
const map = L.map("map", {
  zoomControl: true,
  maxBounds: L.latLngBounds([s - 0.05, w - 0.05], [n + 0.05, e + 0.05]),
  minZoom: 11,
}).setView(DEFAULT.center, 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

const meMarker = L.marker(DEFAULT.center, {
  icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
  zIndexOffset: 1000,
}).addTo(map);
const radiusCircle = L.circle(DEFAULT.center, { radius: 1000, color: "#0f7b6c", weight: 1, fillOpacity: 0.04 }).addTo(map);
const toiletLayer = L.layerGroup().addTo(map);

const pinIcon = (hot) =>
  L.divIcon({ className: "", html: `<div class="wc-pin${hot ? " hot" : ""}"><span>WC</span></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });

// ── 상태 ───────────────────────────────────────────
let origin = { lat: DEFAULT.center[0], lng: DEFAULT.center[1], fromGps: false };
let toilets = [];
let searchSeq = 0;

// ── 유틸 ───────────────────────────────────────────
function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);
const walkMin = (m) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const is24h = (t) => t.hours && /24\/7|24시간/.test(t.hours);

function directionLinks(t) {
  const nm = encodeURIComponent(t.name);
  return {
    kakao: `https://map.kakao.com/link/to/${nm},${t.lat},${t.lng}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=walking`,
  };
}

function filtered() {
  return toilets
    .filter((t) => (!$("fFree").checked || t.free === true))
    .filter((t) => (!$("f24").checked || is24h(t)))
    .filter((t) => (!$("fAcc").checked || t.accessible))
    .filter((t) => (!$("fBaby").checked || t.babyChange));
}

// ── 렌더 ───────────────────────────────────────────
function render() {
  const list = filtered();
  toiletLayer.clearLayers();
  $("list").innerHTML = "";

  list.forEach((t, i) => {
    const links = directionLinks(t);
    const tags = [
      t.kind === "station" ? "역" : t.kind === "facility" ? "건물 내" : "공중",
      t.gate === "outside" ? "개찰구 밖" : t.gate === "inside" ? "개찰구 안(교통카드 필요)" : null,
      is24h(t) ? "24시간" : t.hours ? esc(t.hours) : null,
      t.free === true ? "무료" : t.free === false ? "유료" : null,
      t.accessible ? "장애인" : null,
      t.babyChange ? "기저귀대" : null,
      t.emergencyBell ? "비상벨" : null,
      t.cctv ? "입구 CCTV" : null,
      t.stalls ? `칸 수 남${t.stalls.male + t.stalls.urinal}·여${t.stalls.female}` : null,
    ].filter(Boolean);
    const sourceLabel = t.sources?.includes("public") ? "공공데이터" : "OSM";

    const popup = `<b>${esc(t.name)}</b><br>${t.detail ? esc(t.detail) + "<br>" : t.address ? esc(t.address) + "<br>" : ""}${fmtDist(t.dist)} · 도보 약 ${walkMin(t.dist)}분<br>
      <a href="${links.kakao}" target="_blank" rel="noopener">카카오맵 길찾기</a>`;
    const m = L.marker([t.lat, t.lng], { icon: pinIcon(i === 0) }).bindPopup(popup).addTo(toiletLayer);

    const li = document.createElement("li");
    li.className = "item";
    li.tabIndex = 0;
    li.innerHTML = `
      <span class="name">${esc(t.name)}</span>
      <span class="dist">${fmtDist(t.dist)}</span>
      <span class="meta">도보 약 ${walkMin(t.dist)}분 ${tags.map((x) => `<span class="tag">${x}</span>`).join("")}<span class="src">${sourceLabel}</span></span>
      ${t.detail ? `<span class="addr"><b>위치:</b> ${esc(t.detail)}</span>` : ""}
      ${t.address ? `<span class="addr">${esc(t.address)}</span>` : ""}
      <span class="go">
        <a href="${links.kakao}" target="_blank" rel="noopener">카카오맵 길찾기</a>
        <a href="${links.google}" target="_blank" rel="noopener">구글 지도</a>
      </span>`;
    const focus = () => {
      map.setView([t.lat, t.lng], Math.max(map.getZoom(), 17));
      m.openPopup();
      document.querySelectorAll(".item.active").forEach((x) => x.classList.remove("active"));
      li.classList.add("active");
    };
    li.addEventListener("click", (ev) => { if (ev.target.tagName !== "A") focus(); });
    li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") focus(); });
    $("list").appendChild(li);
  });

  const nearest = list[0];
  $("urgentSub").textContent = nearest
    ? `${nearest.name} · ${fmtDist(nearest.dist)} · 도보 약 ${walkMin(nearest.dist)}분 → 바로 길찾기`
    : "주변에서 찾지 못했어요. 반경을 넓혀 보세요.";

  if (!toilets.length) $("status").textContent = "이 반경 안에 등록된 화장실이 없어요. 반경을 넓혀 보세요.";
  else $("status").textContent = `${origin.fromGps ? "내 위치" : "선택한 지점"} 기준 ${list.length}곳${list.length !== toilets.length ? ` (전체 ${toilets.length}곳 중)` : ""}`;
}

// ── 조회 ───────────────────────────────────────────
async function search() {
  const radius = Number($("radius").value);
  meMarker.setLatLng([origin.lat, origin.lng]);
  radiusCircle.setLatLng([origin.lat, origin.lng]).setRadius(radius);

  const region = regionOf(origin.lat, origin.lng);
  if (!region) {
    toilets = [];
    toiletLayer.clearLayers();
    $("list").innerHTML = "";
    $("status").textContent = `현재는 ${activeRegions().map((r) => r.name).join(", ")}만 지원해요. 지도에서 지원 지역 안을 눌러 주세요.`;
    $("urgentSub").textContent = "지원 지역 밖이에요";
    return;
  }
  $("regionLabel").textContent = region.name;

  const req = ++searchSeq;
  $("status").textContent = "주변 화장실을 찾는 중…";
  try {
    const data = await loadRegion(region.id);
    if (req !== searchSeq) return; // 그 사이 다른 지점을 눌렀으면 무시
    toilets = data.toilets
      .map((t) => ({ ...t, dist: distance(origin, t) }))
      .filter((t) => t.dist <= radius)
      .sort((a, b) => a.dist - b.dist);
    render();
  } catch (err) {
    if (req !== searchSeq) return;
    console.error(err);
    $("status").textContent = "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.";
    $("urgentSub").textContent = "불러오기 실패 — 눌러서 다시 시도";
  }
}

function locate() {
  if (!navigator.geolocation) {
    $("status").textContent = "이 브라우저는 위치 기능을 지원하지 않아요. 지도를 눌러 위치를 선택하세요.";
    return search();
  }
  $("urgentSub").textContent = "위치 확인 중…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lng: pos.coords.longitude, fromGps: true };
      map.setView([origin.lat, origin.lng], 16);
      search();
    },
    () => {
      origin = { lat: DEFAULT.center[0], lng: DEFAULT.center[1], fromGps: false };
      map.setView(DEFAULT.center, 16);
      search().then(() => {
        $("status").textContent = "위치 권한이 없어 서울시청 기준으로 보여드려요. 지도를 눌러 위치를 바꿀 수 있어요. " + $("status").textContent;
      });
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

// ── 이벤트 ─────────────────────────────────────────
map.on("click", (ev) => {
  origin = { lat: ev.latlng.lat, lng: ev.latlng.lng, fromGps: false };
  search();
});
$("locate").addEventListener("click", locate);
$("radius").addEventListener("change", search);
["fFree", "f24", "fAcc", "fBaby"].forEach((id) => $(id).addEventListener("change", render));
$("urgent").addEventListener("click", () => {
  const nearest = filtered()[0];
  if (!nearest) return toilets.length ? null : search();
  window.open(directionLinks(nearest).kakao, "_blank", "noopener");
});

locate();
