// 지원 지역 설정.
// 전국으로 확장할 때는 이 배열에 지역을 추가하고 enabled: true 로 바꾸면 됩니다.
// bounds: [남, 서, 북, 동] (위도/경도). 지역 판정과 지도 이동 제한에 사용합니다.
export const REGIONS = [
  {
    id: "seoul",
    name: "서울특별시",
    enabled: true,
    center: [37.5665, 126.978], // 서울시청
    bounds: [37.4133, 126.7341, 37.7151, 127.2693],
    addressPrefixes: ["서울특별시", "서울시", "서울 "], // 공공데이터 주소로 지역을 고를 때 사용
  },
  // 확장 예시 (아직 비활성)
  { id: "busan", name: "부산광역시", enabled: false, center: [35.1796, 129.0756], bounds: [34.8799, 128.7650, 35.3896, 129.3114], addressPrefixes: ["부산광역시", "부산 "] },
  { id: "incheon", name: "인천광역시", enabled: false, center: [37.4563, 126.7052], bounds: [37.1500, 126.3500, 37.7900, 126.8000], addressPrefixes: ["인천광역시", "인천 "] },
  { id: "gyeonggi", name: "경기도", enabled: false, center: [37.2750, 127.0095], bounds: [36.8930, 126.3800, 38.2900, 127.8500], addressPrefixes: ["경기도"] },
];

export const activeRegions = () => REGIONS.filter((r) => r.enabled);

export function regionOf(lat, lng) {
  return (
    activeRegions().find(
      (r) => lat >= r.bounds[0] && lat <= r.bounds[2] && lng >= r.bounds[1] && lng <= r.bounds[3]
    ) || null
  );
}
