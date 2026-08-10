import { Assets, type Texture } from "pixi.js";

/**
 * 픽셀아트 텍스처를 **확대 보간 없이** 받는다.
 *
 * **왜 필요한가**: 우리 캐릭터는 58px 피사체를 화면에서 ≈230px로 띄운다(4배).
 * Pixi의 기본 스케일 모드는 `linear`라 그 4배가 전부 선형 보간된다 —
 * 스크린샷에서 아군이 "회백색으로 번진 덩어리"로 보인 이유의 절반이 이것이다
 * (나머지 절반은 소프트 글로우 이펙트였다). 픽셀아트는 확대해도 픽셀이 사각형
 * 으로 남아야 하고, 그게 저해상도 에셋을 **의도**로 읽히게 하는 유일한 조건이다.
 *
 * 전역 기본값(`TextureStyle.defaultOptions`)을 건드리지 않는 이유: 같은 기본값을
 * 폰트 글리프 아틀라스도 쓴다. 텍스트까지 nearest가 되면 안티에일리어싱이 사라져
 * 한글 획이 깨진다 — 픽셀아트 시트만 골라서 바꾼다.
 *
 * `Texture.source.scaleMode`는 원본 소스의 속성이다. 같은 소스에서 잘라낸
 * 프레임 텍스처(`new Texture({ source })`)는 자동으로 따라오므로, 시트를 받을
 * 때 한 번만 세우면 된다.
 */
export async function loadPixelTexture(url: string): Promise<Texture> {
  const tex = await Assets.load<Texture>(url);
  applyPixelScale(tex);
  return tex;
}

/** 이미 받아 둔 텍스처에 nearest를 세운다. 멱등하다 */
export function applyPixelScale(tex: Texture | null | undefined): void {
  // 매니페스트(JSON)를 받은 경우엔 source가 없다 — 조용히 지나간다
  if (!tex?.source) return;
  tex.source.scaleMode = "nearest";
  /**
   * 확대만 하는 것이 아니다 — 게이지가 움직이면 필드 높이가 바뀌어 캐릭터가
   * 축소되는 프레임도 있다. 밉맵이 있으면 축소 시 흐린 밉 레벨이 뽑혀서
   * nearest를 세운 의미가 없어진다.
   */
  tex.source.autoGenerateMipmaps = false;
}
