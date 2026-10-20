import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, requestUrl, TFile } from "obsidian";
import BeautyTasksPlugin from "../src/main";
import { GCalAuth } from "../src/gcalAuth";
import { DEFAULT_GCAL_SETTINGS, emptyGCalCache, GCalSync, seedGCalCache, type GCalSyncSettings } from "../src/gcalSync";
import type { Task } from "../src/types";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, AbstractInputSuggest: class {},
  Platform: { isDesktopApp: false }, requestUrl: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TZ", "Asia/Taipei"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function loadSettings(gcal?: Partial<GCalSyncSettings>) {
  const plugin = Object.create(BeautyTasksPlugin.prototype) as BeautyTasksPlugin;
  plugin.loadData = vi.fn(async () => gcal ? { gcal } : null);
  plugin.saveData = vi.fn(async () => {});
  plugin.app = { loadLocalStorage: () => null, saveLocalStorage: vi.fn() } as unknown as App;
  await plugin.loadSettings();
  return plugin;
}

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1", path: "tasks/t-1.md", title: "測試任務", status: "todo", priority: "none",
  labels: [], due: "2026-10-20", dueTime: "15:45", ...over,
} as Task);

type EventBody = Record<string, unknown> & {
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
};

function syncFixture(settings: GCalSyncSettings, initialTask = task()) {
  const cache = emptyGCalCache();
  const file = new TFile();
  const frontmatter: Record<string, unknown> = {};
  const app = {
    vault: { getAbstractFileByPath: () => file },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { processFrontMatter: async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update(frontmatter) },
  } as unknown as App;
  const auth = new GCalAuth(() => null, {
    load: () => ({ accessToken: "test-only", refreshToken: "test-only", expiresAt: Date.now() + 3600_000 }),
    save: async () => {},
  });
  const writes: { method: string; body: EventBody }[] = [];
  let remote: Record<string, unknown> | null = null;
  vi.mocked(requestUrl).mockImplementation(async (options) => {
    const method = options.method ?? "GET";
    let json: Record<string, unknown>;
    if (method === "GET") json = options.url.includes("/events?")
      ? { items: remote ? [remote] : [], nextSyncToken: "next" }
      : remote ?? {};
    else {
      const body = JSON.parse(options.body as string);
      writes.push({ method, body });
      json = { id: "ev-1", ...body };
    }
    return { status: 200, json, text: JSON.stringify(json), headers: {}, arrayBuffer: new ArrayBuffer(0) };
  });
  const sync = new GCalSync({
    app, settings, cache, allTasks: () => [initialTask], subscribe: () => () => {},
    persist: async () => {}, persistCache: async () => {},
  }, auth);
  return { sync, cache, writes, frontmatter, setRemote: (event: Record<string, unknown>) => { remote = event; } };
}

describe("Google 同步時區", () => {
  it("台灣裝置新建 15:45 任務，送出的時間在台灣仍是 15:45", async () => {
    const plugin = await loadSettings();
    const settings = Object.assign(plugin.settings.gcal!, { enabled: true, calendarId: "test-calendar" });
    const { sync, writes } = syncFixture(settings);
    await sync.syncNow();
    expect(sync.getStatus().lastError).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0].body.start).toEqual({ dateTime: "2026-10-20T15:45:00", timeZone: "Asia/Taipei" });
    expect(writes[0].body.end).toEqual({ dateTime: "2026-10-20T16:45:00", timeZone: "Asia/Taipei" });
  });

  it("台灣裝置載入舊柏林預設後會儲存修正，重新載入不會再改使用者指定的柏林時區", async () => {
    const plugin = await loadSettings({ timezone: "Europe/Berlin" });
    expect(plugin.settings.gcal!.timezone).toBe("Asia/Taipei");
    expect(plugin.saveData).toHaveBeenCalled();
    plugin.settings.gcal!.timezone = "Europe/Berlin";
    await plugin.saveSettings();
    const saved = vi.mocked(plugin.saveData).mock.calls.at(-1)![0] as { gcal: GCalSyncSettings };
    expect((await loadSettings(saved.gcal)).settings.gcal!.timezone).toBe("Europe/Berlin");
  });

  it("保留其他明確指定的時區", async () => {
    expect((await loadSettings({ timezone: "Asia/Tokyo" })).settings.gcal!.timezone).toBe("Asia/Tokyo");
  });

  it("其他地區跟隨裝置時區，也不遷移柏林設定", async () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect((await loadSettings()).settings.gcal!.timezone).toBe("Asia/Tokyo");
    expect((await loadSettings({ timezone: "Europe/Berlin" })).settings.gcal!.timezone).toBe("Europe/Berlin");
  });

  it.each(["2026-10-20T15:45:00+02:00", "2026-10-20T13:45:00Z", "2026-10-20T21:45:00+08:00"])("修正舊事件時接受不同回應時區 %s，且不把 21:45 寫回任務", async (dateTime) => {
    const settings = { ...DEFAULT_GCAL_SETTINGS, enabled: true, calendarId: "test-calendar", timezone: "Asia/Taipei" };
    const t = task();
    const { sync, cache, writes, frontmatter, setRemote } = syncFixture(settings, t);
    seedGCalCache(cache, [t], () => ({ gcal_event_id: "ev-1", gcal_calendar_id: settings.calendarId }));
    setRemote({
      id: "ev-1", start: { dateTime, timeZone: "Europe/Berlin" },
      description: "保留原有描述", extendedProperties: { private: { btTaskId: "t-1" } },
    });
    await sync.syncNow();
    expect(sync.getStatus().lastError).toBeNull();
    expect(frontmatter.due).toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("PUT");
    expect(writes[0].body.start.timeZone).toBe("Asia/Taipei");
    expect(writes[0].body.start.dateTime).toBe("2026-10-20T15:45:00");
    expect(writes[0].body.description).toBe("保留原有描述");
    setRemote({ id: "ev-1", ...writes[0].body, start: { dateTime: "2026-10-20T15:45:00+08:00", timeZone: "Asia/Taipei" } });
    await sync.syncNow();
    expect(writes).toHaveLength(1);
  });

  it("變更時區會更新既有事件，即使任務本身未修改", async () => {
    const settings = { ...DEFAULT_GCAL_SETTINGS, enabled: true, calendarId: "test-calendar", timezone: "Asia/Tokyo" };
    const { sync, writes } = syncFixture(settings);
    await sync.syncNow();
    settings.timezone = "Asia/Taipei";
    await sync.syncNow();
    expect(writes).toHaveLength(2);
    expect(writes[1].body.start.timeZone).toBe("Asia/Taipei");
  });

  it("Google 實際改過時間仍會寫回任務，包含跨日的時區轉換", async () => {
    const settings = { ...DEFAULT_GCAL_SETTINGS, enabled: true, calendarId: "test-calendar", timezone: "Asia/Taipei" };
    const t = task();
    const { sync, cache, writes, frontmatter, setRemote } = syncFixture(settings, t);
    seedGCalCache(cache, [t], () => ({ gcal_event_id: "ev-1", gcal_calendar_id: settings.calendarId }));
    setRemote({
      id: "ev-1", start: { dateTime: "2026-10-20T20:45:00+02:00", timeZone: "Europe/Berlin" },
      extendedProperties: { private: { btTaskId: "t-1" } },
    });
    await sync.syncNow();
    expect(frontmatter.due).toBe("2026-10-21T02:45");
    expect(writes).toHaveLength(0);
  });

  it("停用事件更新時仍遵守設定，不強制修正遠端事件", async () => {
    const settings = { ...DEFAULT_GCAL_SETTINGS, enabled: true, calendarId: "test-calendar", timezone: "Asia/Taipei", syncOnUpdate: false };
    const t = task();
    const { sync, cache, writes, frontmatter, setRemote } = syncFixture(settings, t);
    seedGCalCache(cache, [t], () => ({ gcal_event_id: "ev-1", gcal_calendar_id: settings.calendarId }));
    setRemote({ id: "ev-1", start: { dateTime: "2026-10-20T15:45:00+02:00", timeZone: "Europe/Berlin" } });
    await sync.syncNow();
    expect(writes).toHaveLength(0);
    expect(frontmatter.due).toBe("2026-10-20T21:45");
  });

  it("跨午夜保留結束日期，全天任務不帶時區", async () => {
    const settings = { ...DEFAULT_GCAL_SETTINGS, enabled: true, calendarId: "test-calendar", timezone: "Asia/Taipei" };
    const timed = syncFixture(settings, task({ dueTime: "23:45", duration: 90 }));
    await timed.sync.syncNow();
    expect(timed.writes[0].body.end).toEqual({ dateTime: "2026-10-21T01:15:00", timeZone: "Asia/Taipei" });
    const allDay = syncFixture(settings, task({ dueTime: null }));
    await allDay.sync.syncNow();
    expect(allDay.writes[0].body.start).toEqual({ date: "2026-10-20" });
    expect(allDay.writes[0].body.end).toEqual({ date: "2026-10-21" });
  });
});
