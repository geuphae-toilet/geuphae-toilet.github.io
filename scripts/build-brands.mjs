// 화장실을 쓸 수 있는 프랜차이즈 매장(현재: 스타벅스)을 OpenStreetMap에서 받아
// data/brands/<지역>/<브랜드>.json 으로 저장하고 병합합니다.
// 사용법:  node scripts/build-brands.mjs            (활성 지역 전체)
//          node scripts/build-brands.mjs busan      (특정 지역)
//
// 브랜드를 추가하려면 BRANDS 배열에 항목을 추가하면 됩니다.
import { writeFile, mkdir } from "node:fs/promises";
import { REGIONS } from "../js/regions.js";
import { mergeRegion } from "./merge.mjs";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const UA = "seoul-toilet-finder/0.1 (personal non-commercial project)";

export const BRANDS = [
  {
    id: "starbucks",
    label: "스타벅스",
    // 브랜드 위키데이터 ID 또는 이름으로 찾기 (태그가 빠진 매장도 잡도록)
    filters: ['["brand:wikidata"="Q37158"]', '["name"~"스타벅스|Starbucks",i]'],
    note: "매장 이용 고객용이에요. 영수증에 적힌 화장실 비밀번호가 필요한 매장이 있어요.",
  },
];

// 공용 서버가 바쁘면 502/504/429를 줄 때가 있어 잠시 쉬었다가 다시 시도
async function fetchWithRetry(query, label, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: "data=" + encodeURIComponent(query),
    });
    if (res.ok) return res.json();
    if (i >= tries || ![429, 502, 503, 504].includes(res.status)) throw new Error(`[${label}] HTTP ${res.status}`);
    const wait = 15 * i;
    console.log(`[${label}] 서버가 바빠요 (HTTP ${res.status}). ${wait}초 후 다시 시도 (${i}/${tries - 1})`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

const ids = process.argv.slice(2);
const targets = ids.length ? REGIONS.filter((r) => ids.includes(r.id)) : REGIONS.filter((r) => r.enabled);

for (const r of targets) {
  const [s, w, n, e] = r.bounds;
  const bbox = `${s},${w},${n},${e}`;
  const dir = new URL(`../data/brands/${r.id}/`, import.meta.url);
  await mkdir(dir, { recursive: true });

  for (const b of BRANDS) {
    const query = `[out:json][timeout:120];
(
${b.filters.map((f) => `  nwr["amenity"="cafe"]${f}(${bbox});`).join("\n")}
);
out center tags;`;
    console.log(`[${r.id}/${b.id}] 요청 중…`);
    const json = await fetchWithRetry(query, `${r.id}/${b.id}`);

    const seen = new Set();
    const toilets = [];
    for (const el of json.elements) {
      const id = `${el.type}/${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) continue;
      if (t.toilets === "no" || t.disused === "yes") continue; // 화장실 없음으로 표시된 매장·폐점 제외
      // 지점명은 보통 branch 태그에 따로 있음 (예: name=스타벅스, branch=시청)
      let name = t["name:ko"] || t.name || b.label;
      if (!name.includes(b.label)) name = `${b.label} ${name}`;
      const branch = t["branch:ko"] || t.branch;
      if (branch && !name.includes(branch)) name = `${name} ${branch}${/점$/.test(branch) ? "" : "점"}`;
      toilets.push({
        id,                       // OSM id 그대로: 병합 때 같은 매장이 두 번 들어가지 않게
        name,
        lat: +lat.toFixed(6),
        lng: +lng.toFixed(6),
        hours: t.opening_hours || null,
        free: null,               // 음료 구매가 필요할 수 있음
        accessible: t["toilets:wheelchair"] === "yes" || t.wheelchair === "yes",
        babyChange: t.changing_table === "yes",
        unisex: false,
        kind: "cafe",
        brand: b.id,
        brandLabel: b.label,
        note: b.note,
      });
    }
    const out = { region: r.id, brand: b.id, source: "OpenStreetMap", updated: new Date().toISOString().slice(0, 10), toilets };
    await writeFile(new URL(`${b.id}.json`, dir), JSON.stringify(out));
    console.log(`[${r.id}/${b.id}] ${toilets.length}곳 저장 → data/brands/${r.id}/${b.id}.json`);
  }
  await mergeRegion(r.id);
}
