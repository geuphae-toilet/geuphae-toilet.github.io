// 지역별 화장실 데이터를 OpenStreetMap에서 받아 data/<regionId>.json 으로 저장합니다.
// 사용법:  node scripts/build-data.mjs            (활성 지역 전체)
//          node scripts/build-data.mjs busan      (특정 지역)
import { writeFile, mkdir } from "node:fs/promises";
import { REGIONS } from "../js/regions.js";
import { toToilet } from "../js/dataSource.js";
import { mergeRegion } from "./merge.mjs";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const UA = "seoul-toilet-finder/0.1 (personal non-commercial project)";

const ids = process.argv.slice(2);
const targets = ids.length ? REGIONS.filter((r) => ids.includes(r.id)) : REGIONS.filter((r) => r.enabled);

await mkdir(new URL("../data/osm/", import.meta.url), { recursive: true });

for (const r of targets) {
  const [s, w, n, e] = r.bounds;
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:180];
(
  nwr["amenity"="toilets"](${bbox});
  nwr["toilets"="yes"](${bbox});
);
out center tags;`;
  console.log(`[${r.id}] 요청 중…`);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`[${r.id}] HTTP ${res.status}`);
  const json = await res.json();
  const seen = new Set();
  const toilets = json.elements.map(toToilet).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
  const out = { region: r.id, source: "OpenStreetMap", updated: new Date().toISOString().slice(0, 10), toilets };
  await writeFile(new URL(`../data/osm/${r.id}.json`, import.meta.url), JSON.stringify(out));
  console.log(`[${r.id}] ${toilets.length}곳 저장 → data/osm/${r.id}.json`);
  await mergeRegion(r.id);
}
