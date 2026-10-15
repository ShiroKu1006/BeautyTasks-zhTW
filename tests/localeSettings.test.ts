import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moment } from "obsidian";
import BeautyTasksPlugin from "../src/main";
import { applyDefaults } from "../src/settingsDelta";
import { getLocale, setLocale, t } from "../src/i18n";

// 只替換 Obsidian 宿主 API；實際執行外掛的 applyLocale() 與設定儲存邏輯。
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, AbstractInputSuggest: class {},
  Platform: { isDesktopApp: false },
  moment: { locale: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => setLocale("en"));

const pluginWithLocale = (locale: string): BeautyTasksPlugin => {
  const plugin = Object.create(BeautyTasksPlugin.prototype) as BeautyTasksPlugin;
  plugin.settings = applyDefaults({ locale });
  return plugin;
};

describe("外掛套用手動與自動語系", () => {
  it.each([["zh-tw", "zh-TW"], ["zh-Hant", "zh-TW"], ["zh-cn", "zh"], ["en", "en"]])("auto 跟隨 Obsidian %s → %s", (obsidianLocale, expected) => {
    vi.mocked(moment.locale).mockReturnValue(obsidianLocale);
    pluginWithLocale("auto").applyLocale();
    expect(moment.locale).toHaveBeenCalledOnce();
    expect(getLocale()).toBe(expected);
  });

  it("手動繁中優先於 Obsidian 語系，儲存值仍為 zh-TW", async () => {
    vi.mocked(moment.locale).mockReturnValue("zh-cn");
    const plugin = pluginWithLocale("zh-TW");
    plugin.applyLocale();
    expect(moment.locale).not.toHaveBeenCalled();
    expect(t("btn_save")).toBe("儲存");
    plugin.saveData = vi.fn(async () => {});
    await plugin.saveSettings();
    expect(plugin.saveData).toHaveBeenCalledWith({ locale: "zh-TW" });
  });
});
