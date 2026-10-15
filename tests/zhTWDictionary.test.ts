import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { zhTW } from "../src/locales/zh-TW";
import { setLocale, t } from "../src/i18n";

const compiler: typeof ts = createRequire(import.meta.url)("typescript");

// 直接讀取英文原始字典，避免為了測試而改動既有字典的匯出介面。
function englishDictionary(): Record<string, string> {
  const source = compiler.createSourceFile("i18n.ts", readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8"), compiler.ScriptTarget.Latest, true);
  let dictionary: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node): void {
    if (compiler.isVariableDeclaration(node) && node.name.getText(source) === "STRINGS" && node.initializer && compiler.isObjectLiteralExpression(node.initializer)) {
      const en = node.initializer.properties.find((p) => compiler.isPropertyAssignment(p) && p.name.getText(source) === "en");
      if (en && compiler.isPropertyAssignment(en) && compiler.isObjectLiteralExpression(en.initializer)) dictionary = en.initializer;
    }
    compiler.forEachChild(node, visit);
  }
  visit(source);
  if (!dictionary) throw new Error("找不到英文基準字典，請更新覆蓋率測試。");
  return Object.fromEntries(dictionary.properties.map((p) => {
    if (!compiler.isPropertyAssignment(p) || !compiler.isStringLiteral(p.initializer)) throw new Error("英文基準字典包含非字串項目。");
    return [compiler.isStringLiteral(p.name) ? p.name.text : p.name.getText(source), p.initializer.text];
  }));
}

const english = englishDictionary();
const placeholders = (text: string): string[] => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
afterEach(() => setLocale("en"));

describe("zh-TW 字典完整性", () => {
  it("key 與英文完全一致，沒有缺漏或多餘項目", () => {
    expect(Object.keys(english).length).toBeGreaterThan(500);
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(english).sort());
  });

  it("每項譯文皆非空白，並保留每個占位符及出現次數", () => {
    for (const [key, value] of Object.entries(english)) {
      expect(zhTW[key]?.trim(), key).toBeTruthy();
      expect(placeholders(zhTW[key]), key).toEqual(placeholders(value));
    }
  });

  it("每項 key 都實際載入繁中譯文並可替換參數", () => {
    setLocale("zh-TW");
    for (const [key, value] of Object.entries(zhTW)) {
      expect(t(key), key).toBe(value);
      const expected = value.replace(/\{(\d+)\}/g, (_, n: string) => `參數${n}`);
      expect(t(key, "參數0", "參數1", "參數2", "參數3"), key).toBe(expected);
    }
  });

  it("繁中缺少譯文時回退到英文，並繼續替換參數", () => {
    // 模擬上游剛新增 key、翻譯尚未補齊的情況；測試後還原共享字典。
    const key = "confirm_delete_title";
    const saved = zhTW[key];
    setLocale("zh-TW");
    try {
      delete zhTW[key];
      expect(t(key, "測試任務")).toBe(english[key].replace("{0}", "測試任務"));
      expect(t(key, "測試任務")).toBe("Delete “測試任務”?");
    } finally {
      zhTW[key] = saved;
    }
  });
});
