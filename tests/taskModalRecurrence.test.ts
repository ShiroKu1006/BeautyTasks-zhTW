import { describe, expect, it, vi } from "vitest";
import { TaskModal } from "../src/taskModal";
import { QuickAddModal } from "../src/quickAddModal";
import { Task } from "../src/types";
import { nextInstance } from "../src/recurrence";

// Exercise the real editor-to-service boundary without a vault or DOM renderer.
const existing = (): Task => ({
  id: "one", path: "one.md", title: "Exercise", titleInFm: true, status: "todo", priority: "normal",
  due: "2026-10-20", dueTime: null, scheduled: null, scheduledTime: null, duration: null,
  start: null, project: null, parent: null, labels: [], description: "", recurrence: "FREQ=DAILY",
  recurBasis: "due", reminders: [], sortOrder: null, created: "2026-10-20", completed: null,
  cancelled: null, externalId: null,
});

function editor() {
  const successors: unknown[] = [];
  const setTaskStatus = vi.fn(async (task: Task) => { successors.push(nextInstance(task, "2026-10-20")); });
  const modal = new TaskModal({ app: {}, setTaskStatus } as never, existing());
  const internal = modal as unknown as {
    f: Partial<Task>; applyStatus(status: string): Promise<void>; renderChips(): void;
    save(): Promise<void>; persist(): Promise<void>; close(): void;
    persisted: boolean;
  };
  internal.renderChips = () => {};
  return { modal: internal, successors, setTaskStatus };
}

describe("編輯後直接完成採用新的結束條件", () => {
  it("改為剩一次就不再產生下一筆", async () => {
    const { modal, successors } = editor();
    modal.f.recurrence = "FREQ=DAILY;COUNT=1";
    await modal.applyStatus("done");
    expect(successors).toEqual([null]);
  });

  it("使用當前草稿日期與截止日計算下一筆", async () => {
    const { modal, successors } = editor();
    modal.f.due = "2026-10-22";
    modal.f.recurrence = "FREQ=DAILY;UNTIL=20261022T000000Z";
    await modal.applyStatus("done");
    expect(successors).toEqual([null]);
  });

  it("日期衝突時不寫入完成狀態，也不產生後續任務", async () => {
    const { modal, setTaskStatus, successors } = editor();
    modal.f.recurrence = "FREQ=DAILY;UNTIL=20261019T000000Z";
    await modal.applyStatus("done");
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(successors).toEqual([]);
    expect(modal.f.status).toBe("todo");
  });

  it("完成轉換不鎖住後續的編輯儲存", async () => {
    const { modal } = editor();
    modal.f.recurrence = "FREQ=DAILY;COUNT=2";
    await modal.applyStatus("done");
    expect(modal.persisted).toBe(false);
  });

  it("完整編輯的儲存、自動儲存及關閉都阻擋截止日衝突", async () => {
    const { modal } = editor();
    modal.f.recurrence = "FREQ=DAILY;UNTIL=20261019T000000Z";
    // No vault/DOM is provided: reaching a write or base close would throw.
    await expect(modal.save()).resolves.toBeUndefined();
    await expect(modal.persist()).resolves.toBeUndefined();
    expect(() => modal.close()).not.toThrow();
    expect(modal.persisted).toBe(false);
  });

  it("快速新增也在寫入前阻擋截止日衝突", async () => {
    const modal = new QuickAddModal({ app: {} } as never) as unknown as {
      f: { title: string; due: string; recurrence: string }; submit(): Promise<void>;
    };
    modal.f.title = "Exercise";
    modal.f.due = "2026-10-20";
    modal.f.recurrence = "FREQ=DAILY;UNTIL=20261019T000000Z";
    await expect(modal.submit()).resolves.toBeUndefined();
    expect(modal.f.title).toBe("Exercise");
  });
});
