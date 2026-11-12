// 화장실 데이터 소스.
// 지역별 데이터는 scripts/build-data.mjs 가 OpenStreetMap에서 받아 data/<regionId>.json 으로 만들어 둡니다.
// 앱은 그 파일만 읽으므로 응답이 즉시이고, 외부 서버가 느리거나 막혀도 동작합니다.
// 추후 공공데이터포털 "전국공중화장실표준데이터" 등을 쓰려면 같은 Toilet 형태로 변환해 같은 파일에 합치면 됩니다.

/**
 * @typedef {Object} Toilet
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} hours      개방 시간 (예: "24/7")
 * @property {boolean|null} free      무료 여부
 * @property {boolean} accessible     장애인 화장실
 * @property {boolean} babyChange     기저귀 교환대
 * @property {boolean} unisex
 * @property {string} kind            "public" | "station" | "facility"
 */

/** OSM 요소 → Toilet (빌드 스크립트에서 사용) */
export function toToilet(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  if (t.access === "private" || t.access === "no" || t.toilets === "no") return null;

  const isToiletNode = t.amenity === "toilets";
  let kind = "public";
  if (t.railway === "station" || t.public_transport === "station" || t.railway === "subway_entrance") kind = "station";
  else if (!isToiletNode) kind = "facility";

  const baseName = t["name:ko"] || t.name;
  const name =
    baseName && isToiletNode ? baseName
    : baseName ? `${baseName} 내 화장실`
    : kind === "station" ? "역 화장실"
    : "공중화장실";

  const fee = t.fee ?? t["toilets:fee"];
  const wheel = t.wheelchair ?? t["toilets:wheelchair"];
  return {
    id: `${el.type}/${el.id}`,
    name,
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    hours: t.opening_hours || null,
    free: fee === "no" ? true : fee === "yes" ? false : null,
    accessible: wheel === "yes" || wheel === "designated",
    babyChange: t.changing_table === "yes" || t.diaper === "yes",
    unisex: t.unisex === "yes",
    kind,
  };
}

const loaded = new Map(); // regionId → Promise<{updated, toilets}>

/** 지역 데이터 파일을 한 번만 읽어 둡니다. */
export function loadRegion(regionId) {
  if (!loaded.has(regionId)) {
    const p = fetch(new URL(`../data/${regionId}.json`, import.meta.url)).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    p.catch(() => loaded.delete(regionId)); // 실패하면 다음에 다시 시도
    loaded.set(regionId, p);
  }
  return loaded.get(regionId);
}
