// 행정안전부 「전국공중화장실표준데이터」 CSV → data/public/<지역>.json → 병합
//
// 사용법:
//   $env:KAKAO_REST_KEY = "발급받은 REST API 키"     (PowerShell)
//   node scripts/import-public.mjs <CSV 경로> [지역id ...]
//
// - 지역id를 생략하면 활성 지역 전체(현재 서울)를 처리합니다.
// - CSV 에 좌표가 없으면(2025.2 이후 버전) 카카오 주소 검색으로 좌표를 구합니다.
//   결과는 data/public/geocode-cache.json 에 저장되어, 다음 실행 때는 새 주소만 조회합니다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { REGIONS } from "../js/regions.js";
import { mergeRegion } from "./merge.mjs";

const [csvPath, ...regionIds] = process.argv.slice(2);
if (!csvPath) {
  console.error("사용법: node scripts/import-public.mjs <CSV 경로> [지역id ...]");
  process.exit(1);
}
const targets = regionIds.length ? REGIONS.filter((r) => regionIds.includes(r.id)) : REGIONS.filter((r) => r.enabled);
const KEY = process.env.KAKAO_REST_KEY;
const dataDir = new URL("../data/public/", import.meta.url);
const cacheFile = new URL("geocode-cache.json", dataDir);

// ── CSV 읽기 (EUC-KR / UTF-8 자동 판별) ─────────────────
function decode(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 열 이름은 버전마다 공백·하이픈이 조금씩 달라서 정규화해 찾습니다.
const norm = (s) => s.replace(/[\s\-_()·]/g, "").toLowerCase();
function columnFinder(header) {
  const h = header.map(norm);
  return (...names) => {
    for (const n of names.map(norm)) {
      const i = h.indexOf(n);
      if (i >= 0) return i;
    }
    for (const n of names.map(norm)) {
      const i = h.findIndex((x) => x.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
}

const num = (v) => {
  const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};
const yes = (v) => /^(y|yes|예|유|설치|있음|o|1)$/i.test(String(v ?? "").trim());

function hoursText(open, detail) {
  const o = (open || "").trim(), d = (detail || "").trim();
  if (/상시|24시간|00:00\s*~\s*24:00|0:00\s*~\s*24:00/.test(o + " " + d)) return "24시간";
  return [o, d].filter(Boolean).join(" ") || null;
}

// ── 카카오 주소 → 좌표 ─────────────────────────────────
async function geocode(address, name) {
  const call = async (path, query) => {
    const url = `https://dapi.kakao.com${path}?query=${encodeURIComponent(query)}&size=1`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
    if (res.status === 401 || res.status === 403) throw new Error(`카카오 키가 거부되었습니다 (HTTP ${res.status}). 키와 '카카오맵' 사용 설정을 확인하세요.`);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); return call(path, query); }
    if (!res.ok) return null;
    const d = (await res.json()).documents?.[0];
    return d ? { lat: +(+d.y).toFixed(6), lng: +(+d.x).toFixed(6) } : null;
  };
  return (await call("/v2/local/search/address.json", address)) ?? (name ? await call("/v2/local/search/keyword.json", `${name} ${address}`) : null);
}

// ── 실행 ────────────────────────────────────────────
const rows = parseCsv(decode(await readFile(csvPath)));
const header = rows.shift();
const col = columnFinder(header);
const C = {
  kind: col("구분명", "구분"),
  name: col("화장실명"),
  road: col("소재지도로명주소", "도로명주소"),
  jibun: col("소재지지번주소", "지번주소"),
  lat: col("WGS84위도", "위도"),
  lng: col("WGS84경도", "경도"),
  open: col("개방시간"),
  openDetail: col("개방시간상세"),
  mToilet: col("남성용대변기수"),
  mUrinal: col("남성용소변기수"),
  mAcc: col("남성용장애인용대변기수"),
  fToilet: col("여성용대변기수"),
  fAcc: col("여성용장애인용대변기수"),
  bell: col("비상벨설치여부", "비상벨설치유무"),
  cctv: col("화장실입구CCTV설치유무", "CCTV설치유무"),
  unisex: col("남녀공용화장실여부"),
  // 지하철 역사 데이터 전용 열
  station: col("역명"),
  line: col("운영노선명"),
  gate: col("게이트내외구분"),
  exit: col("근접출입구번호", "출입구번호"),
  detail: col("상세위치"),
  phone: col("전화번호"),
  org: col("관리기관명"),
  date: col("데이터기준일자"),
};
// 기저귀교환대는 표준데이터는 1개 열, 지하철 데이터는 남/여/장애인 화장실별 여러 열
const diaperCols = header.map((h, i) => (norm(h).includes("기저귀교환대") && !norm(h).includes("장소") ? i : -1)).filter((i) => i >= 0);
if ((C.name < 0 && C.station < 0) || (C.road < 0 && C.jibun < 0)) {
  console.error("필수 열(화장실명, 주소)을 찾지 못했습니다. 첫 줄 열 이름:", header.join(" | "));
  process.exit(1);
}
const get = (r, i) => (i >= 0 ? (r[i] ?? "").trim() : "");
// 원본 파일마다 결과를 따로 저장 (예: 지하철 데이터와 전국 데이터를 모두 넣을 수 있게)
const fileTag = basename(csvPath).replace(/\.[^.]+$/, "").replace(/[^\w가-힣-]/g, "_");
console.log(`CSV ${rows.length}행 읽음`);

await mkdir(dataDir, { recursive: true });
let cache = {};
try { cache = JSON.parse(await readFile(cacheFile, "utf8")); } catch {}

for (const region of targets) {
  const mine = rows.filter((r) => {
    const addr = get(r, C.road) || get(r, C.jibun);
    return region.addressPrefixes?.some((p) => addr.startsWith(p));
  });
  console.log(`[${region.id}] 해당 지역 ${mine.length}행`);

  const needGeo = mine.filter((r) => !(+get(r, C.lat) && +get(r, C.lng)) && !cache[get(r, C.road) || get(r, C.jibun)]);
  if (needGeo.length && !KEY) {
    console.error(`[${region.id}] 좌표가 없는 ${needGeo.length}곳을 변환하려면 KAKAO_REST_KEY 환경변수가 필요합니다.`);
    process.exit(1);
  }

  let done = 0, failed = 0;
  for (const r of needGeo) {
    const addr = get(r, C.road) || get(r, C.jibun);
    let p = await geocode(addr, get(r, C.name));
    if (!p && get(r, C.jibun) && addr !== get(r, C.jibun)) p = await geocode(get(r, C.jibun));
    cache[addr] = p ?? false;
    if (!p) failed++;
    if (++done % 200 === 0) {
      console.log(`  좌표 변환 ${done}/${needGeo.length}`);
      await writeFile(cacheFile, JSON.stringify(cache));
    }
  }
  if (needGeo.length) {
    await writeFile(cacheFile, JSON.stringify(cache));
    console.log(`[${region.id}] 좌표 변환 ${needGeo.length}곳 (실패 ${failed})`);
  }

  const [s, w, n, e] = region.bounds;
  const toilets = [];
  mine.forEach((r, i) => {
    const addr = get(r, C.road) || get(r, C.jibun);
    const p = +get(r, C.lat) && +get(r, C.lng) ? { lat: +get(r, C.lat), lng: +get(r, C.lng) } : cache[addr];
    if (!p || p.lat < s || p.lat > n || p.lng < w || p.lng > e) return;
    const accStalls = num(get(r, C.mAcc)) + num(get(r, C.fAcc));
    const kindText = get(r, C.kind);
    const station = get(r, C.station);
    const line = get(r, C.line);
    const gate = get(r, C.gate);
    const exitNo = get(r, C.exit);
    toilets.push({
      id: `public/${region.id}/${fileTag}/${i}`,
      name: get(r, C.name) || (station ? `${station}역${line ? ` ${line}` : ""} 화장실` : "공중화장실"),
      lat: p.lat,
      lng: p.lng,
      address: addr,
      detail: [get(r, C.detail), exitNo && !get(r, C.detail).includes(`${exitNo}번`) ? `${exitNo}번 출입구 근처` : ""].filter(Boolean).join(" · ") || null,
      // 개찰구 밖이면 교통카드 없이 이용 가능
      gate: /외/.test(gate) ? "outside" : /내/.test(gate) ? "inside" : null,
      hours: hoursText(get(r, C.open), get(r, C.openDetail)),
      free: true, // 공중화장실법상 공중화장실은 무료 개방이 원칙
      accessible: accStalls > 0,
      babyChange: diaperCols.some((c) => yes(r[c])),
      unisex: yes(get(r, C.unisex)),
      emergencyBell: yes(get(r, C.bell)),
      cctv: yes(get(r, C.cctv)),
      stalls: { male: num(get(r, C.mToilet)), urinal: num(get(r, C.mUrinal)), female: num(get(r, C.fToilet)), accessible: accStalls },
      phone: get(r, C.phone) || null,
      kind: station || /역|지하철|철도/.test(kindText + get(r, C.name)) ? "station" : /개방/.test(kindText) ? "facility" : "public",
      kindLabel: kindText || null,
    });
  });

  const out = { region: region.id, source: basename(csvPath), updated: new Date().toISOString().slice(0, 10), toilets };
  const regionDir = new URL(`${region.id}/`, dataDir);
  await mkdir(regionDir, { recursive: true });
  await writeFile(new URL(`${fileTag}.json`, regionDir), JSON.stringify(out));
  console.log(`[${region.id}] 공공데이터 ${toilets.length}곳 저장 → data/public/${region.id}/${fileTag}.json`);
  await mergeRegion(region.id);
}
