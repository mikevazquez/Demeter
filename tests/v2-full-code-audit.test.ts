import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, it } from "vitest";

function filesUnder(root: string, extension = ".tsx") {
  const out: string[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(extension)) out.push(full);
    }
  }
  walk(join(process.cwd(), root));
  return out;
}

function rel(path: string) {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function hasAwaitInsideForBlock(source: string) {
  const lines = source.split("\n");
  for (let start = 0; start < lines.length; start += 1) {
    if (!/^\s*for\s*\([^)]*\)\s*\{/.test(lines[start])) continue;

    let depth = 0;
    let opened = false;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index];
      for (const char of line) {
        if (char === "{") {
          depth += 1;
          opened = true;
        } else if (char === "}") {
          depth -= 1;
        }
      }

      if (index > start && /\bawait\b/.test(line)) return true;
      if (opened && depth <= 0) break;
    }
  }
  return false;
}

describe("V2 codebase audit inventory", () => {
  it("prints visual and performance findings for the full app surface", () => {
    const adminFiles = filesUnder("app/admin");
    const studentFiles = filesUnder("app/student");
    const coachFiles = filesUnder("app/coach");
    const loginFiles = filesUnder("app/login");
    const responsibleFiles = filesUnder("app/responsable");
    const accessFiles = filesUnder("app/acceso");
    const setupFiles = filesUnder("app/setup");
    const allPortalFiles = [
      ...adminFiles,
      ...studentFiles,
      ...coachFiles,
      ...loginFiles,
      ...responsibleFiles,
      ...accessFiles,
      ...setupFiles,
    ];
    const pageFiles = allPortalFiles.filter((path) => path.endsWith("/page.tsx"));

    const darkUtilities = adminFiles
      .map((path) => {
        const source = readFileSync(path, "utf8");
        const count =
          (source.match(/\btext-white\b/g) ?? []).length +
          (source.match(/\bbg-black(?:\/\d+)?\b/g) ?? []).length +
          (source.match(/\bborder-white(?:\/\d+)?\b/g) ?? []).length +
          (source.match(/\b(?:text|bg|border)-fuchsia-[^\s"'\x60}]*/g) ?? []).length;
        return { path: rel(path), count };
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    const customDialogs = allPortalFiles
      .filter((path) =>
        /role=["']dialog["']|aria-modal|fixed\s+inset-0/.test(readFileSync(path, "utf8")),
      )
      .map(rel);

    const manualLoaders = allPortalFiles
      .filter((path) => /animate-spin|animate-pulse/.test(readFileSync(path, "utf8")))
      .map(rel);

    const nativeConfirms = allPortalFiles
      .filter((path) =>
        /window\.confirm\s*\(|\bconfirm\s*\(|window\.alert\s*\(|\balert\s*\(/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map(rel);

    const sequentialContext = pageFiles
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return /const\s+\w+\s*=\s*await\s+(?:searchParams|params);[\s\S]{0,500}?await\s+get(?:AdminContext|StudentPortalContext)/.test(
          source,
        );
      })
      .map(rel);

    const rpcInsideMap = pageFiles
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return /\.map\s*\(\s*async[\s\S]{0,1200}?\.rpc\s*\(/.test(source);
      })
      .map(rel);

    const awaitInsideLoop = pageFiles
      .filter((path) => hasAwaitInsideForBlock(readFileSync(path, "utf8")))
      .map(rel);

    const heavyPages = pageFiles
      .map((path) => {
        const source = readFileSync(path, "utf8");
        return {
          path: rel(path),
          awaits: (source.match(/\bawait\b/g) ?? []).length,
          parallelRounds: (source.match(/Promise\.all\s*\(/g) ?? []).length,
          selects: (source.match(/\.select\s*\(/g) ?? []).length,
          rpcs: (source.match(/\.rpc\s*\(/g) ?? []).length,
        };
      })
      .filter((item) => item.awaits >= 5)
      .sort((a, b) => b.awaits - a.awaits);

    console.log(
      "V2_AUDIT=" +
        JSON.stringify({
          totals: {
            adminTsx: adminFiles.length,
            studentTsx: studentFiles.length,
            coachTsx: coachFiles.length,
            loginTsx: loginFiles.length,
            responsibleTsx: responsibleFiles.length,
            accessTsx: accessFiles.length,
            setupTsx: setupFiles.length,
            pages: pageFiles.length,
          },
          darkUtilities: darkUtilities.slice(0, 80),
          customDialogs,
          manualLoaders,
          nativeConfirms,
          sequentialContext,
          rpcInsideMap,
          awaitInsideLoop,
          heavyPages: heavyPages.slice(0, 60),
        }),
    );
  });
});
