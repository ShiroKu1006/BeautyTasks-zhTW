import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { GCalAuth, loopbackPage, type GCalTokens } from "../src/gcalAuth";
import { gcalRequest } from "../src/gcalSync";
import { setLocale } from "../src/i18n";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  Platform: { isDesktopApp: false },
  requestUrl: vi.fn(),
}));

const store = (tokens: GCalTokens | null = null) => ({ load: () => tokens, save: vi.fn(async () => {}) });
const validTokens = (): GCalTokens => ({ accessToken: "test-only", refreshToken: "test-only", expiresAt: Date.now() + 3600_000 });
const reply = (status: number, json: Record<string, unknown> = {}) => ({
  status, json, text: JSON.stringify(json), headers: {}, arrayBuffer: new ArrayBuffer(0),
});

beforeEach(() => { setLocale("zh-TW"); vi.clearAllMocks(); });
afterEach(() => setLocale("en"));

describe("Google 連線的本機訊息", () => {
  it("授權完成頁的成功、失敗與關閉提示皆為繁中，並標示正確語言", () => {
    expect(loopbackPage(true)).toContain('<html lang="zh-TW">');
    expect(loopbackPage(true)).toContain("BeautyTasks 已與 Google Calendar 連線。");
    expect(loopbackPage(false)).toContain("登入失敗，請回到 Obsidian 再試一次。");
    expect(loopbackPage(false)).toContain("你可以關閉這個視窗。");
    setLocale("de");
    expect(loopbackPage(true)).toContain("BeautyTasks ist jetzt mit Google Kalender verbunden.");
    expect(loopbackPage(false)).toContain("Du kannst dieses Fenster schließen.");
  });

  it("尚未連線時顯示繁中訊息", async () => {
    const auth = new GCalAuth(() => null, store());
    await expect(auth.getAccessToken()).rejects.toThrow("尚未與 Google 連線。");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("缺少憑證時顯示繁中訊息", async () => {
    const auth = new GCalAuth(() => null, store());
    await expect(auth.connect()).rejects.toThrow("尚未設定 Google API 憑證。");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("Token 回應缺少欄位時顯示繁中訊息，且不儲存錯誤回應", async () => {
    vi.mocked(requestUrl).mockResolvedValue(reply(200));
    const tokenStore = store({ ...validTokens(), expiresAt: 0 });
    const auth = new GCalAuth(() => ({ clientId: "test-only" }), tokenStore);
    await expect(auth.getAccessToken()).rejects.toThrow("Google 回傳的 Token 資料不完整。");
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it("401 只翻譯重新連線提示，不改動錯誤處理", async () => {
    vi.mocked(requestUrl).mockResolvedValue(reply(401));
    const auth = new GCalAuth(() => ({ clientId: "test-only" }), store(validTokens()));
    await expect(gcalRequest(auth, "GET", "/test")).rejects.toThrow("Google 連線已失效，請重新連線。");
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  it("保留外部服務錯誤原文，只翻譯本機前綴", async () => {
    vi.mocked(requestUrl).mockResolvedValue(reply(400, { error: { message: "External API message" } }));
    const auth = new GCalAuth(() => ({ clientId: "test-only" }), store(validTokens()));
    await expect(gcalRequest(auth, "GET", "/test")).rejects.toThrow("Google Calendar：External API message");
  });
});
