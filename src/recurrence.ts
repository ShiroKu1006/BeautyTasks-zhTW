import { RRule, Frequency, Options } from "rrule";
import { Task } from "./types";

/**
 * Wiederholungen. Zwei Schreibweisen, ein Rechenweg.
 *
 * ── Warum überhaupt RRULE ────────────────────────────────────────────────────
 * `every 3 months` ist unsere gewachsene Schreibweise und bleibt lesbar und gültig. Sie kann aber
 * nur „alle n Einheiten". Regeln wie „nur werktags", „jeder zweite Dienstag" oder „letzter Freitag
 * im Monat" braucht eine Aufgabenverwaltung früher oder später, und dafür gibt es mit RFC 5545
 * (iCalendar) eine Sprache, die Google, Apple und Outlook ohnehin sprechen. Statt dafür eine
 * eigene Syntax zu erfinden, lesen und rechnen wir RRULE – über `rrule`, damit die harten Teile
 * (BYDAY, BYSETPOS, COUNT, UNTIL, Monatsenden) nicht hier nachgebaut werden.
 *
 * ── Was RRULE NICHT kann, und warum das ein eigenes Feld hat ─────────────────
 * RFC 5545 leitet alle Termine aus `DTSTART` plus Regel ab; sie stehen im Voraus fest. Eine
 * Wiederholung, die vom TAG DER ERLEDIGUNG zählt („alle 7 Tage nach der letzten Anwendung"),
 * ist darin nicht ausdrückbar – kein Feld, keine Erweiterung. Genau deshalb hat Outlook dafür
 * eigene Musterklassen (DailyRegenerationPattern & Co., ausdrücklich nur für Aufgaben) und
 * Todoist eine eigene Syntax (`every!`). Unser `recur_basis: done` ist dieselbe Lösung: ein
 * Schalter NEBEN der Regel, nicht in ihr. Die RRULE bleibt dadurch für Fremdprogramme gültig.
 *
 * ── Die eine Stelle, die das Format kennt ────────────────────────────────────
 * Alles darüber (Texterkennung, Chips, Index, Ansichten) arbeitet mit `Rule` bzw. reicht den
 * Text durch. Deshalb kostet eine neue Schreibweise nur diese Datei.
 */

export interface Rule { n: number; unit: "day" | "week" | "month" | "year"; }

const UNIT_FREQ: Record<Rule["unit"], Frequency> = {
  day: RRule.DAILY, week: RRule.WEEKLY, month: RRule.MONTHLY, year: RRule.YEARLY,
};
export const FREQ_UNIT = new Map<Frequency, Rule["unit"]>([
  [RRule.DAILY, "day"], [RRule.WEEKLY, "week"], [RRule.MONTHLY, "month"], [RRule.YEARLY, "year"],
]);

/** Unsere gewachsene Schreibweise: „every day", „every 3 months". */
function parseEveryText(rule: string): Rule | null {
  const m = rule.trim().toLowerCase().match(/^every\s+(\d+)?\s*(day|week|month|year)s?$/);
  if (!m) return null;
  return { n: m[1] ? parseInt(m[1], 10) : 1, unit: m[2] as Rule["unit"] };
}

/**
 * RRULE-Text zu Optionen. Bewusst nachsichtig, weil fremde Programme unterschiedlich schreiben:
 * TaskForge liefert `DTSTART:20260821;FREQ=YEARLY;…` in EINER Zeile, andere setzen `RRULE:` davor.
 * `DTSTART` interessiert uns nie – der Anker kommt aus der Aufgabe, nicht aus der Regel.
 */
function parseRRuleText(rule: string): Partial<Options> | null {
  const body = rule
    .replace(/^\s*RRULE:/i, "")
    .replace(/DTSTART(?:;[^:;]*)?:[^;\s]*;?/i, "")
    .trim();
  if (!/FREQ=/i.test(body)) return null;
  try {
    const opts = RRule.parseString(body);
    if (opts.freq === undefined) return null;
    // Unterhalb eines Tages hat unser Modell keine Auflösung: Fälligkeiten sind Kalendertage.
    // `FREQ=HOURLY` lieferte sonst immer wieder denselben Tag – eine Wiederholung, die sich
    // nicht bewegt. Ablehnen ist die einzige ehrliche Antwort darauf.
    if (!FREQ_UNIT.has(opts.freq)) return null;
    return opts;
  } catch { return null; }   // kaputte Regel -> wie „keine Regel"
}

/**
 * Regel -> RRULE-Optionen, gleich in welcher Schreibweise sie vorliegt. Der eine Weg für alle,
 * die eine Regel deuten wollen, ohne beide Schreibweisen zu kennen – Rechnen wie Anzeige.
 */
export function ruleOptions(rule: string): Partial<Options> | null {
  const simple = parseEveryText(rule);
  return simple ? { freq: UNIT_FREQ[simple.unit], interval: simple.n } : parseRRuleText(rule);
}

/**
 * Die EINFACHE Gestalt einer Regel: „alle n Einheiten", sonst `null`.
 *
 * Für Anzeige und Gruppierung – nicht zum Rechnen. `null` heisst deshalb nicht „ungültig",
 * sondern „lässt sich nicht auf ein blosses Intervall verkürzen" (etwa `FREQ=MONTHLY;BYDAY=-1FR`).
 * Aufrufer, die gruppieren, zeigen solche Regeln im Rohtext – das ist ehrlicher, als sie auf ein
 * Intervall zu runden, das sie nicht sind.
 */
export function parseRecurrence(rule: string): Rule | null {
  const simple = parseEveryText(rule);
  if (simple) return simple;
  const opts = parseRRuleText(rule);
  if (!opts || opts.freq === undefined) return null;
  const unit = FREQ_UNIT.get(opts.freq);
  if (!unit) return null;   // SECONDLY/MINUTELY/HOURLY: kennt unser Modell nicht
  // Alles, was die Regel über das blosse Intervall hinaus einschränkt, macht sie nicht-einfach.
  const extra = opts.byweekday ?? opts.bymonthday ?? opts.bymonth ?? opts.bysetpos ?? opts.byyearday ?? opts.byweekno;
  if (extra != null && (!Array.isArray(extra) || extra.length > 0)) return null;
  return { n: opts.interval && opts.interval > 0 ? opts.interval : 1, unit };
}

/** Versteht BeautyTasks diese Regel überhaupt? Getrennt von `parseRecurrence`, weil eine
 *  komplexe RRULE gültig IST, sich aber nicht auf `{n, unit}` verkürzen lässt. */
export function isValidRecurrence(rule: string): boolean {
  return parseEveryText(rule) !== null || parseRRuleText(rule) !== null;
}

const FREQ_NAME: Record<Rule["unit"], string> = {
  day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY",
};

/** Ein einfaches Intervall als RRULE. `INTERVAL=1` wird weggelassen – es ist der Vorgabewert,
 *  und die kürzere Regel ist die, die man beim Draufschauen noch versteht. */
export function toRRuleString(rule: Rule): string {
  return "FREQ=" + FREQ_NAME[rule.unit] + (rule.n > 1 ? ";INTERVAL=" + rule.n : "");
}

/**
 * Alte Schreibweise -> RRULE, für die einmalige Umstellung bestehender Notizen.
 *
 * `null` heisst „hier ist nichts zu tun" – entweder steht dort schon eine RRULE, oder der Text
 * ist keiner, den wir je geschrieben haben. Beides bleibt unangetastet: Eine Migration, die im
 * Zweifel nichts tut, ist wiederholbar; eine, die rät, ist es nicht.
 */
export function legacyToRRule(rule: string): string | null {
  const simple = parseEveryText(rule);
  return simple ? toRRuleString(simple) : null;
}

// ── Datumsrechnung ───────────────────────────────────────────────────────────
// Durchweg UTC-Mitternacht: `rrule` rechnet in UTC, und unsere Datumsangaben sind reine
// Kalendertage ohne Zeitzone. Über lokale Zeit zu gehen verschöbe Termine bei Sommerzeitwechseln
// um einen Tag – ein Fehler, der nur zweimal im Jahr auftritt und deshalb schwer zu finden ist.
const z = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
const fromIso = (iso: string) => new Date(iso + "T00:00:00Z");
const addDays = (iso: string, days: number) => { const d = fromIso(iso); d.setUTCDate(d.getUTCDate() + days); return toIso(d); };
const ms = (iso: string) => fromIso(iso).getTime();

export type RecurrenceEnd =
  | { mode: "never" }
  | { mode: "until"; date: string }
  | { mode: "count"; count: number };

const validDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(ms(date)) && toIso(fromIso(date)) === date;

/** COUNT is the number remaining, including the task holding this rule. */
export function getRecurrenceEnd(rule?: string | null): RecurrenceEnd {
  const opts = rule ? ruleOptions(rule) : null;
  if (opts?.until instanceof Date) return { mode: "until", date: toIso(opts.until) };
  if (typeof opts?.count === "number") return { mode: "count", count: opts.count };
  return { mode: "never" };
}

/** Replace only the end clauses; preserve complex frequency clauses and imported prefixes. */
export function setRecurrenceEnd(rule: string, end: RecurrenceEnd): string | null {
  if (!isValidRecurrence(rule)) return null;
  if (end.mode === "count" && (!Number.isSafeInteger(end.count) || end.count < 1)) return null;
  if (end.mode === "until" && !validDate(end.date)) return null;
  const raw = legacyToRRule(rule) ?? rule.trim();
  const prefix = /^RRULE:/i.test(raw) ? raw.slice(0, 6) : "";
  const body = raw.slice(prefix.length).split(";").filter((part) => !/^(COUNT|UNTIL)=/i.test(part)).join(";");
  const suffix = end.mode === "count" ? ";COUNT=" + end.count
    : end.mode === "until" ? ";UNTIL=" + end.date.replace(/-/g, "") + "T000000Z" : "";
  return prefix + body + suffix;
}

/** A new frequency from a preset or title must not erase a manually selected end. */
export function preserveRecurrenceEnd(rule: string, previous?: string | null): string {
  if (!previous) return rule;
  const end = getRecurrenceEnd(previous);
  return end.mode === "never" ? rule : setRecurrenceEnd(rule, end) ?? rule;
}

/** Shared by the picker and both editors, including their auto-save paths. */
export function recurrenceEndError(rule?: string | null, due?: string | null, scheduled?: string | null): string | null {
  const end = getRecurrenceEnd(rule);
  if (end.mode === "count" && (!Number.isSafeInteger(end.count) || end.count < 1)) return "recur_end_invalid_count";
  if (end.mode === "until") {
    if (!validDate(end.date)) return "recur_end_invalid_date";
    const start = due || scheduled;
    if (start && end.date < start) return "recur_end_before_task";
  }
  return null;
}

/** Find a future occurrence and carry the unconsumed count into the successor. */
function nextAfter(rule: string, anchorIso: string, afterIso: string, fromDone = false): { date: string; recurrence: string } | null {
  const opts = ruleOptions(rule);
  if (!opts) return null;
  const count = opts.count;
  if (typeof count === "number" && count <= 1) return null;
  const anchor = fromIso(anchorIso), after = fromIso(afterIso);
  const rr = new RRule({ ...opts, ...(fromDone ? { count: null } : {}), dtstart: anchor });
  let consumed = 1; // The current task always occupies one slot, even if manually moved off-pattern.
  let next: Date | null = null;
  if (typeof count === "number" && !fromDone) {
    rr.all((date) => {
      if (date > after) { if (consumed < count) next = date; return false; }
      if (date > anchor) consumed++;
      return consumed < count;
    });
  } else {
    next = rr.after(after, false);
  }
  if (!next) return null;
  const recurrence = typeof count === "number"
    ? rule.replace(/(^|[;:\s])COUNT=\d+/i, (_m, pre: string) => pre + "COUNT=" + (count - consumed))
    : rule;
  return { date: toIso(next), recurrence };
}

/**
 * Fälligkeit(en) der nächsten Instanz. `null` = keine gültige oder keine weitere Wiederholung.
 *
 * basis „done": ab dem Erledigungstag (heute) – der Abstand zwischen zwei Erledigungen ist der
 * Zweck. basis „due": ab dem alten Fälligkeitsdatum, dem Kalender folgend.
 *
 * In beiden Fällen wird ein Termin ECHT NACH heute gesucht. Sonst käme eine längst überfällige
 * Wiederholung sofort wieder als überfällig zurück, und der Nutzer hakt sie mehrfach ab, ohne
 * dass sich etwas bewegt.
 *
 * `scheduled` wandert mit und behält seinen Abstand zu `due` – wer „drei Tage vorher einplanen"
 * eingestellt hat, will das auch in der nächsten Runde.
 */
export function nextInstance(task: Task, today: string): { due: string | null; scheduled: string | null; recurrence: string } | null {
  if (!task.recurrence || !isValidRecurrence(task.recurrence)) return null;
  const fromDone = task.recurBasis === "done";

  if (task.due) {
    const anchor = fromDone ? today : task.due;
    const after = fromDone ? today : (ms(task.due) > ms(today) ? task.due : today);
    const next = nextAfter(task.recurrence, anchor, after, fromDone);
    if (!next) return null;
    const nextDue = next.date;
    let nextScheduled: string | null = null;
    if (task.scheduled) {
      const gap = Math.round((ms(task.scheduled) - ms(task.due)) / 86400000);
      nextScheduled = addDays(nextDue, gap);
    }
    return { due: nextDue, scheduled: nextScheduled, recurrence: next.recurrence };
  }
  if (task.scheduled) {
    const anchor = fromDone ? today : task.scheduled;
    const after = fromDone ? today : (ms(task.scheduled) > ms(today) ? task.scheduled : today);
    const next = nextAfter(task.recurrence, anchor, after, fromDone);
    return next ? { due: null, scheduled: next.date, recurrence: next.recurrence } : null;
  }
  // Regel ohne jedes Datum. Das ist ein Widerspruch – die Regel sagt WANN, ohne Anker gibt es kein
  // Wann – und wird deshalb gar nicht erst zugelassen (chips.ts haelt das Datum nach). In
  // Bestandsdaten steht es aber: frueher liess sich das Datum leeren, ohne dass die Regel mitging.
  // Statt aufzugeben wird ab heute gerechnet. Sonst verschwaende die Aufgabe beim Abhaken
  // ERSATZLOS, und der Nutzer merkte es erst, wenn sie nie wiederkam.
  const fallback = nextAfter(task.recurrence, today, today, true);
  return fallback ? { due: fallback.date, scheduled: null, recurrence: fallback.recurrence } : null;
}

/**
 * Die ERSTE Fälligkeit für eine Regel, ab `from` einschliesslich.
 *
 * Braucht es, weil eine Regel Tage vorschreiben kann, die ein frei gewähltes Datum nicht trifft:
 * „letzter Freitag im Monat" mit Fälligkeit auf irgendeinem Freitag wäre schlicht falsch. Für
 * Regeln ohne solche Einschränkung (`FREQ=WEEKLY` und Verwandte) ist `from` selbst der erste
 * Termin – dann ändert diese Funktion nichts.
 *
 * `null` = Regel unlesbar oder schon ausgelaufen; der Aufrufer behält dann sein Datum.
 */
export function firstOccurrence(rule: string, from: string): string | null {
  const opts = ruleOptions(rule);
  if (!opts) return null;
  const start = fromIso(from);
  const hit = new RRule({ ...opts, dtstart: start }).after(start, true);
  return hit ? toIso(hit) : null;
}

