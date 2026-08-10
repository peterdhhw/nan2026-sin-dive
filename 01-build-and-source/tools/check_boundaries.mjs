#!/usr/bin/env node
/**
 * 폴더 경계 검사 — 규칙을 문서가 아니라 CI가 지키게 한다.
 *
 * 왜 스크립트인가: `submission/`은 "자기완결"이고 `shared/`는 "모드 중립"인데,
 * 둘 다 **어기기 쉽고 어겨도 화면은 멀쩡하다.** typecheck·테스트는 통과한다 —
 * `shared/`가 `pvp/`를 하나만 import해도 컴파일은 되고 PvP는 잘 돌아간다.
 * 싱글을 만드는 사람이 몇 주 뒤에야 "공용이라더니 PvP가 통째로 딸려온다"를
 * 발견하게 되고, 그때는 되돌리기 훨씬 비싸다. 그래서 지금 자동으로 잡는다.
 *
 * 실제로 이 검사를 만들 때 위반 4건이 이미 있었다 (`shared/layout`→`core/gauge`,
 * `shared/screenText`→`pvp/session`, `shared/battleField`→`pvp/interferenceRules`,
 * `shared/portraitManifest`→`pvp/matchRules`). 눈으로 안 잡힌다는 뜻이다.
 *
 * 실행: `npm run check:boundaries` (CI가 typecheck·test와 함께 돌린다)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** import/export 문의 경로만 뽑는다. 주석 안의 경로 언급은 규칙 위반이 아니다 */
const SPEC_RE = /\b(?:import|export)\b[^;]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".cache") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}

function specsOf(src) {
  const out = [];
  for (const re of [SPEC_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

/** 상대 경로 지정자를 레포 기준 경로로 바꾼다. 패키지 이름은 null */
function resolveSpec(fileAbs, spec) {
  if (!spec.startsWith(".")) return null;
  return relative(ROOT, resolve(join(fileAbs, ".."), spec)).replaceAll("\\", "/");
}

const violations = [];
const add = (file, spec, rule) =>
  violations.push({
    file: relative(ROOT, file).replaceAll("\\", "/"),
    spec,
    rule,
  });

/**
 * 규칙 1 — 의존은 한 방향으로만 흐른다: core → shared → {pvp, single}.
 *
 * 뒤쪽을 앞쪽이 import하면 "공용"이 거짓이 된다. `single/`이 `pvp/`를 보는 것도
 * 막는다 — 그러면 두 모드가 서로를 잠그고 한쪽 수정이 다른 쪽을 깬다.
 */
const LAYER_OF = (p) =>
  p.startsWith("src/core/")
    ? "core"
    : p.startsWith("src/shared/")
      ? "shared"
      : p.startsWith("src/pvp/")
        ? "pvp"
        : p.startsWith("src/single/")
          ? "single"
          : null;

/** 이 층은 오른쪽 층들만 import할 수 있다 */
const MAY_IMPORT = {
  core: new Set(["core"]),
  shared: new Set(["core", "shared"]),
  pvp: new Set(["core", "shared", "pvp"]),
  single: new Set(["core", "shared", "single"]),
};

for (const file of walk(join(ROOT, "src"))) {
  const from = relative(ROOT, file).replaceAll("\\", "/");
  const fromLayer = LAYER_OF(from);
  for (const spec of specsOf(readFileSync(file, "utf8"))) {
    const target = resolveSpec(file, spec);
    if (!target) continue;
    const toLayer = LAYER_OF(target);
    if (!fromLayer || !toLayer) continue;
    if (!MAY_IMPORT[fromLayer].has(toLayer)) {
      add(file, spec, `${fromLayer}/ 는 ${toLayer}/ 를 import할 수 없다`);
    }
  }
}

/**
 * 규칙 2 — `submission/` 밖을 참조하지 않는다 (README §2).
 *
 * 제출 시 이 폴더만 떼어 별도 레포로 만든다. 밖으로 나가는 경로가 하나라도
 * 있으면 그때 처음 발견되고, 마감(8/10) 당일에 고칠 일이 된다.
 */
for (const file of walk(join(ROOT, "src")).concat(
  walk(join(ROOT, "tests")),
)) {
  for (const spec of specsOf(readFileSync(file, "utf8"))) {
    const target = resolveSpec(file, spec);
    if (target !== null && target.startsWith("..")) {
      add(file, spec, "submission/ 밖을 참조한다 (자기완결 위반)");
    }
  }
}

if (violations.length > 0) {
  console.error(`\n경계 위반 ${violations.length}건:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    → "${v.spec}"`);
    console.error(`    ✗ ${v.rule}\n`);
  }
  console.error(
    "고치는 방향: 공용 쪽으로 심볼을 올리거나(모드 중립일 때), 모드 쪽으로\n" +
      "내리거나(한 모드만의 개념일 때) 둘 중 하나다. 공용 파일에서 모드\n" +
      "파일을 import하는 우회는 규칙 자체를 무의미하게 만든다.\n",
  );
  process.exit(1);
}

console.log("경계 검사 통과 — core → shared → {pvp, single}, submission/ 자기완결");
