/**
 * `localStorage` 접근을 감싸는 **단 하나의** 자리.
 *
 * 설계 문서: docs/SAVE-SCHEMA.md §1
 *
 * ## 왜 래퍼가 필요한가
 *
 * 사파리 프라이빗 모드는 `localStorage`를 **읽는 것 자체가 던진다**(quota 0).
 * 씬이 직접 만지면 저장값 하나 때문에 부팅이 죽는다 — 게임은 저장이 없어도
 * 굴러가야 하므로 여기서 `null`로 접어 버린다. 부르는 쪽은 `null` 하나만
 * 다루면 된다(`saveRules.readSingleSave`, `cardRules.readOwned`).
 *
 * ## 왜 이 파일이 여기 있는가 (이력)
 *
 * 예전에는 `scenes/pickRules.ts`가 이 함수를 들고 있었다 — 캐릭터 선택이
 * 처음으로 저장을 쓴 기능이라 거기서 태어났고, 싱글 저장·카드함이 나중에
 * 그것을 재사용했다. 2단계에서 캐릭터 선택을 지우면서 `pickRules.ts`가
 * **이 함수 하나만 남은 224줄**이 됐다. 지운 기능의 이름을 가진 파일에서
 * 살아 있는 저장이 나오면 다음 사람이 "이건 선택 전용인가"를 묻게 된다.
 *
 * 반환 타입이 `Pick<Storage, ...>`인 이유: 테스트가 `Map` 하나로 대역을
 * 세울 수 있다. `Storage` 전체를 요구하면 쓰지도 않는 `key`·`length`를
 * 대역마다 채워야 한다.
 */
export type AppStore = Pick<Storage, "getItem" | "setItem"> | null;

export function appStore(): AppStore {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
