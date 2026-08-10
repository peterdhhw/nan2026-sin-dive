import { defineConfig } from "vite";
import { bedrockStrategyPlugin } from "./vite-plugin-bedrock";

/**
 * dev 서버를 code-server 프록시 뒤에서 볼 때 붙일 경로 접두사.
 *
 * 이 인스턴스는 공용 IP가 없어서 브라우저가 code-server의 포트 프록시를 타고
 * 들어온다. 두 경로가 있고 **둘은 다르게 동작한다**:
 *
 * - `/proxy/5173/` — 접두사를 **떼고** 앱에 넘긴다. 그래서 index.html의
 *   `/src/main.ts`(절대경로)가 code-server 루트로 가서 404가 된다. HTML만
 *   200으로 뜨고 스크립트가 전부 죽으므로 **빈 화면**이 된다.
 * - `/absproxy/5173/` — 접두사를 **유지**한다. 앱이 그 접두사를 `base`로
 *   알고 있어야 링크가 맞는다.
 *
 * 그래서 dev에서는 `VITE_BASE`로 접두사를 받는다. 빌드는 `./`를 그대로 쓴다
 * (산출물은 정적 호스팅·서브디렉터리에 얹히므로 상대경로여야 한다).
 */
const DEV_BASE = process.env.VITE_BASE ?? "/absproxy/5173/";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? DEV_BASE : "./",
  server: {
    /**
     * Vite 5.4는 DNS 리바인딩 방어로 Host 헤더를 검사한다. 프록시를 타고 온
     * 호스트가 목록에 없으면 403 "Blocked request"로 HTTP 단에서 끊긴다 —
     * 브라우저 콘솔에는 아무것도 안 남아서 "그냥 안 보인다"로만 보인다.
     * 배포마다 CloudFront 서브도메인이 바뀌므로 도메인 전체를 허용한다.
     */
    allowedHosts: [".cloudfront.net"],
    /**
     * HMR 소켓도 프록시(443/wss)를 타야 한다. 기본값은 dev 서버 포트인
     * 5173으로 붙으려 해서 원격에서는 실패한다 — 화면은 뜨지만 저장할 때마다
     * 콘솔에 연결 실패가 쌓이고 자동 리로드가 죽는다.
     */
    hmr: { clientPort: 443, protocol: "wss" },
  },
  // dev 전용 플러그인 (configureServer만 구현) — 빌드 산출물에는 이 경로가 없다
  plugins: [bedrockStrategyPlugin()],
  build: { outDir: "dist", assetsInlineLimit: 0 },
  test: { globals: true, environment: "node" },
}));
