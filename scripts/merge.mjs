// data/osm/<id>.json 과 data/public/<id>.json 을 합쳐 앱이 읽는 data/<id>.json 을 만듭니다.
// 같은 화장실(가까운 거리)로 보이면 공공데이터 쪽 정보를 우선하고 OSM 에만 있는 정보로 빈칸을 채웁니다.
// 단독 실행:  node scripts/merge.mjs seoul
import { readFile, writeFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MATCH_M = 40; // 이 거리 안의 두 지점은 같은 화장실로 봅니다

const file = (p) => new URL(`../data/${p}`, import.meta.url);
async function readJson(p) {
  try { return JSON.parse(await readFile(file(p), "utf8")); } catch { return null; }
}

function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function mergeRegion(id) {
  const osm = (await readJson(`osm/${id}.json`))?.toilets ?? [];
  // data/public/<id>/ 안의 모든 공공데이터 파일 (지하철, 전국 표준 등)
  let pubFiles = [];
  try { pubFiles = (await readdir(file(`public/${id}/`))).filter((f) => f.endsWith(".json")); } catch {}
  const pub = [];
  for (const f of pubFiles) pub.push(...((await readJson(`public/${id}/${f}`))?.toilets ?? []));

  // 약 0.001도(≈100m) 격자로 OSM 지점을 나눠 두고 근처 칸만 비교
  const grid = new Map();
  const cell = (lat, lng) => `${Math.floor(lat * 1000)},${Math.floor(lng * 1000)}`;
  osm.forEach((t, i) => {
    const k = cell(t.lat, t.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const used = new Set();

  const merged = pub.map((p) => {
    let best = -1, bestD = MATCH_M;
    const [cy, cx] = [Math.floor(p.lat * 1000), Math.floor(p.lng * 1000)];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const i of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          if (used.has(i)) continue;
          const d = distance(p, osm[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
    if (best < 0) return { ...p, sources: ["public"] };
    used.add(best);
    const o = osm[best];
    return {
      ...p,
      hours: p.hours ?? o.hours,
      free: p.free ?? o.free,
      accessible: p.accessible || o.accessible,
      babyChange: p.babyChange || o.babyChange,
      unisex: p.unisex || o.unisex,
      sources: ["public", "osm"],
    };
  });

  osm.forEach((o, i) => { if (!used.has(i)) merged.push({ ...o, sources: ["osm"] }); });

  const out = {
    region: id,
    updated: new Date().toISOString().slice(0, 10),
    counts: { total: merged.length, public: pub.length, osm: osm.length, matched: used.size },
    toilets: merged,
  };
  await writeFile(file(`${id}.json`), JSON.stringify(out));
  console.log(`[${id}] 병합 완료: 공공 ${pub.length} + OSM ${osm.length} (겹침 ${used.size}) → 총 ${merged.length}곳`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const id of process.argv.slice(2)) await mergeRegion(id);
}
