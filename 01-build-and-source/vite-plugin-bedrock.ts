import type { Plugin } from "vite";

/**
 * dev 서버에서만 Bedrock을 대리 호출한다. 자격증명은 Node 프로세스에 머무르고
 * 브라우저로 나가지 않는다. 프로덕션 번들에는 이 경로가 없으므로
 * 배포 사이트는 로컬 프리셋만 쓴다 (createStrategyAdapter의 enabled=false).
 *
 * 검증된 모델 id: on-demand가 막혀 있어 추론 프로필을 써야 한다.
 */
const MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";
const REGION = process.env["AWS_REGION"] ?? "ap-northeast-2";

export function bedrockStrategyPlugin(): Plugin {
  return {
    name: "abyss-bedrock-strategy",
    configureServer(server) {
      server.middlewares.use("/__bedrock/strategy", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          void (async () => {
            try {
              const { prompt } = JSON.parse(
                Buffer.concat(chunks).toString(),
              ) as {
                prompt: string;
              };
              // 지연 import — Bedrock SDK가 없어도 dev 서버는 떠야 한다
              const { BedrockRuntimeClient, InvokeModelCommand } = await import(
                "@aws-sdk/client-bedrock-runtime"
              );
              const client = new BedrockRuntimeClient({ region: REGION });
              const out = await client.send(
                new InvokeModelCommand({
                  modelId: MODEL_ID,
                  contentType: "application/json",
                  body: JSON.stringify({
                    anthropic_version: "bedrock-2023-05-31",
                    max_tokens: 128,
                    messages: [{ role: "user", content: prompt }],
                  }),
                }),
              );
              const parsed = JSON.parse(new TextDecoder().decode(out.body)) as {
                content: { text: string }[];
              };
              const text = parsed.content[0]?.text ?? "";
              // dev 전용 로그 — 전략 갱신이 실제로 돌고 있는지 눈으로 확인한다
              server.config.logger.info(
                `[bedrock] strategy ${text.replace(/\s+/g, " ").slice(0, 80)}`,
              );
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ text }));
            } catch (err) {
              // 게임은 로컬 프리셋으로 계속 돈다 — 500을 돌려주면 된다
              server.config.logger.warn(`[bedrock] ${String(err)}`);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          })();
        });
      });
    },
  };
}
