import { describe, expect, it } from "vitest";
import { getRecurrenceEnd, setRecurrenceEnd, preserveRecurrenceEnd, recurrenceEndError } from "../src/recurrence";

describe("重複結束條件", () => {
  it("讀取三種結束模式", () => {
    expect(getRecurrenceEnd("every week")).toEqual({ mode: "never" });
    expect(getRecurrenceEnd("FREQ=DAILY;COUNT=4")).toEqual({ mode: "count", count: 4 });
    expect(getRecurrenceEnd("RRULE:FREQ=DAILY;UNTIL=20261120T000000Z")).toEqual({ mode: "until", date: "2026-11-20" });
  });

  it("切換模式移除舊限制，保留原本複雜週期", () => {
    const rule = "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4";
    expect(setRecurrenceEnd(rule, { mode: "until", date: "2026-11-20" }))
      .toBe("FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20261120T000000Z");
    expect(setRecurrenceEnd("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261120T000000Z", { mode: "count", count: 1 }))
      .toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=1");
    expect(setRecurrenceEnd(rule, { mode: "never" })).toBe("FREQ=MONTHLY;BYDAY=-1FR");
  });

  it("舊文字格式仍可加入結束條件", () => {
    expect(setRecurrenceEnd("every 3 months", { mode: "count", count: 4 }))
      .toBe("FREQ=MONTHLY;INTERVAL=3;COUNT=4");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒絕無效次數 %s", (count) => {
    expect(setRecurrenceEnd("FREQ=DAILY", { mode: "count", count })).toBeNull();
  });

  it.each(["", "2026-02-30", "2026-2-03", "2026-11-20T12:00", "invalid"])("拒絕無效日期 %s", (date) => {
    expect(setRecurrenceEnd("FREQ=DAILY", { mode: "until", date })).toBeNull();
  });

  it("更換頻率保留次數或截止日期", () => {
    expect(preserveRecurrenceEnd("FREQ=WEEKLY;BYDAY=MO", "FREQ=DAILY;COUNT=4"))
      .toBe("FREQ=WEEKLY;BYDAY=MO;COUNT=4");
    expect(preserveRecurrenceEnd("FREQ=MONTHLY", "FREQ=DAILY;UNTIL=20261120T000000Z"))
      .toBe("FREQ=MONTHLY;UNTIL=20261120T000000Z");
  });

  it("指定截止日可以等於任務日期，但不可早於它", () => {
    const rule = "FREQ=DAILY;UNTIL=20261120T000000Z";
    expect(recurrenceEndError(rule, "2026-11-20")).toBeNull();
    expect(recurrenceEndError(rule, "2026-11-25")).toBe("recur_end_before_task");
    expect(recurrenceEndError(rule, null, "2026-11-25")).toBe("recur_end_before_task");
    expect(recurrenceEndError(rule, "2026-11-19", "2026-11-25")).toBeNull();
    expect(recurrenceEndError(null, "2026-11-25")).toBeNull();
  });
});
