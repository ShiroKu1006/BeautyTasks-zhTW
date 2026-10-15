import { afterEach, describe, expect, it } from "vitest";
import { getLocale, pickLocale, projectDisplayName, setLocale, t } from "../src/i18n";
import { chronoFallback, hasChronoFallback } from "../src/chronoLocale";
import { parseQuickEntry } from "../src/quickEntry";
import { describeRecurrence } from "../src/recurrenceText";
import { formatDate, formatDeadline, groupLabel } from "../src/format";
import { formatLogTime } from "../src/detailLog";
import { applyDefaults, toDelta } from "../src/settingsDelta";
import { DEFAULT_STATUSES, statusLabel } from "../src/statuses";

afterEach(() => setLocale("en"));

describe("台灣繁體中文語系", () => {
  it.each(["zh-TW", "zh-tw", "zh_TW", "zh-Hant", "zh-Hant-TW", " ZH_hant_tw "])("將 %s 識別為 zh-TW", (raw) => {
    expect(pickLocale(raw)).toBe("zh-TW");
  });

  it.each(["zh", "zh-CN", "zh-Hans", "zh-Hans-CN"])("保留 %s 的簡體中文", (raw) => {
    expect(pickLocale(raw)).toBe("zh");
  });

  it("載入翻譯、替換多個占位符，且不改動專案名稱及狀態識別值", () => {
    setLocale("zh-TW");
    expect(getLocale()).toBe("zh-TW");
    expect(t("btn_save")).toBe("儲存");
    expect(t("subtasks_progress", 2, 5)).toBe("已完成 2 / 5");
    expect(projectDisplayName("Inbox")).toBe("收件匣");
    expect(projectDisplayName("研究專案")).toBe("研究專案");
    expect(statusLabel("todo")).toBe("待辦");
    expect(DEFAULT_STATUSES.map((s) => s.id)).toEqual(["todo", "doing", "done", "cancelled"]);
  });

  it.each(["en", "de", "es", "pt", "fr", "tr", "zh", "ru", "ja", "it"])("繁中切換至 %s 後仍載入原語系", (locale) => {
    setLocale(locale);
    const original = t("btn_save");
    setLocale("zh-TW");
    expect(t("btn_save")).toBe("儲存");
    setLocale(locale);
    expect(getLocale()).toBe(locale);
    expect(t("btn_save")).toBe(original);
  });

  it("保存手動選項，重新載入後仍為繁中；auto 保留既有預設", () => {
    const settings = applyDefaults({ locale: "zh-TW" });
    const reloaded = applyDefaults(toDelta(settings));
    expect(reloaded.locale).toBe("zh-TW");
    setLocale(reloaded.locale);
    expect(t("set_language_auto")).toBe("自動（跟隨 Obsidian）");
    expect(applyDefaults({}).locale).toBe("auto");
    // applyLocale() 的 auto 分支傳入 Obsidian moment.locale() 的值。
    setLocale("zh-tw");
    expect(getLocale()).toBe("zh-TW");
  });

  it("未知語系及未知 key 仍安全回退", () => {
    setLocale("unknown");
    expect(getLocale()).toBe("en");
    expect(t("btn_save")).toBe("Save");
    setLocale("zh-TW");
    expect(t("__unknown_translation__", 1)).toBe("__unknown_translation__");
  });
});

describe("繁中日期與週期顯示", () => {
  it.each([
    ["今天", "2026-07-16"], ["明天", "2026-07-17"], ["下週五", "2026-07-24"],
  ])("Quick Add 正確解析 %s，並從任務標題移除日期詞", (phrase, date) => {
    setLocale("zh-TW");
    const ref = new Date(2026, 6, 16, 12);
    const result = parseQuickEntry(`${phrase}寫報告 p1 #重要`, [], ref, chronoFallback());
    expect(result.faellig).toBe(date);
    expect(result.title).toBe("寫報告");
    expect(result.time).toBe("");
    expect(result.priority).toBe("highest");
    expect(result.tags).toEqual(["重要"]);
  });

  it("沿用中文 chrono parser 並保留英文日期輸入", () => {
    expect(hasChronoFallback("zh-TW")).toBe(true);
    expect(chronoFallback("zh-TW")[0]).toBe(chronoFallback("zh")[0]);
    const ref = new Date(2026, 6, 16, 12);
    const result = parseQuickEntry("寫報告 tomorrow p1 #重要", [], ref, chronoFallback("zh-TW"));
    expect(result.faellig).toBe("2026-07-17");
    expect(result.priority).toBe("highest");
    expect(result.tags).toEqual(["重要"]);
  });

  it("以台灣日期順序及星期名稱顯示日期與留言時間", () => {
    setLocale("zh-TW");
    expect(formatDate("2026-07-20", "2026-07-16")).toBe("7月20日");
    expect(formatDate("2025-07-20", "2026-07-16")).toBe("2025年7月20日");
    expect(groupLabel("2026-07-16", "2026-07-16")).toBe("7月16日 · 今天 · 星期四");
    expect(formatDeadline("2026-07-19T14:30", "2026-07-16")).toBe("3 天後 · 14:30");
    const now = new Date(2026, 6, 16, 12);
    expect(formatLogTime("2026-07-16 09:15:00", now)).toBe("今天 · 09:15");
    expect(formatLogTime("2026-07-20 09:15:00", now)).toBe("7月20日 · 09:15");
  });

  it("只翻譯週期顯示，原有 RRULE 與英文週期輸入維持不變", () => {
    setLocale("zh-TW");
    expect(describeRecurrence("FREQ=DAILY")).toBe("每天");
    expect(describeRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")).toBe("每 2 週的星期二");
    expect(describeRecurrence("FREQ=MONTHLY;BYDAY=-1FR")).toBe("每月最後一個星期五");
    expect(describeRecurrence("FREQ=MONTHLY;BYDAY=2MO")).toBe("每月第 2 個星期一");
    expect(describeRecurrence("FREQ=WEEKLY;UNTIL=20261231T000000Z")).toBe("每週 · 至 2026/12/31");
    const ref = new Date(2026, 6, 16, 12);
    expect(parseQuickEntry("寫報告 every second Monday", [], ref, chronoFallback()).recurrence).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
  });
});
