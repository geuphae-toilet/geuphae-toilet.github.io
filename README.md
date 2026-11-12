# 급할때 화장실

과민성 대장증후군(IBS) 등으로 급하게 화장실이 필요한 사람을 위한 근처 화장실 찾기 웹앱. 현재 지원 지역은 서울특별시입니다.

## 실행

```bash
python -m http.server 8080
```

브라우저에서 http://localhost:8080 을 엽니다. 위치 권한을 허용하면 내 위치 기준, 거부하면 서울시청 기준으로 보여 주며 지도를 클릭해 기준 지점을 바꿀 수 있습니다.

## 구조

| 파일 | 역할 |
|---|---|
| `js/regions.js` | 지원 지역 목록 (중심 좌표, 경계, 활성 여부) |
| `js/dataSource.js` | OSM → 공통 Toilet 형태 변환, 지역 데이터 로드 |
| `js/app.js` | 지도·목록·필터·길찾기 UI |
| `scripts/build-data.mjs` | OpenStreetMap 데이터 → `data/osm/<지역>.json` |
| `scripts/import-public.mjs` | 공공데이터 CSV → 좌표 변환 → `data/public/<지역>.json` |
| `scripts/merge.mjs` | 두 데이터를 합쳐 앱이 읽는 `data/<지역>.json` 생성 (40m 안은 같은 화장실로 묶음) |

## 공공데이터 가져오기

현재 들어 있는 공공데이터: **서울교통공사 역사공중화장실정보** (1~8호선, 284곳, `data/source/seoul-metro-toilets.csv`). 좌표가 포함돼 있어 키 없이 가져올 수 있습니다.

```bash
node scripts/import-public.mjs data/source/seoul-metro-toilets.csv
```

원본 CSV 파일마다 `data/public/<지역>/<파일명>.json`으로 따로 저장되고, 병합 때 모두 합쳐집니다.

전국 표준데이터를 추가하려면:

1. 공공데이터포털의 [전국공중화장실표준데이터](https://www.data.go.kr/data/15012892/standard.do) CSV를 받습니다.
2. [Kakao Developers](https://developers.kakao.com)에서 REST API 키를 발급받습니다 (앱 설정에서 '카카오맵' 사용 켜기).
3. 실행 (PowerShell):

```powershell
$env:KAKAO_REST_KEY = "발급받은 키"
node scripts/import-public.mjs "C:\경로\공중화장실정보.csv"
```

2025년 2월 이후 CSV에는 좌표가 없어서 주소를 카카오 API로 좌표로 바꿉니다. 결과는 `data/public/geocode-cache.json`에 저장되어 다음 갱신 때는 새 주소만 조회합니다.

## 전국으로 확장하기

1. `js/regions.js`에서 해당 지역의 `enabled`를 `true`로 바꿉니다 (부산, 인천, 경기는 예시로 들어 있음).
2. `node scripts/build-data.mjs busan` 으로 OSM 데이터를 받습니다.
3. `node scripts/import-public.mjs <CSV> busan` 으로 공공데이터를 합칩니다.
