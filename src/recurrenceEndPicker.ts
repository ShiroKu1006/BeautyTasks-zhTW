import { t } from "./i18n";
import { getRecurrenceEnd, recurrenceEndError, setRecurrenceEnd, RecurrenceEnd } from "./recurrence";

let groupId = 0;

/** Kept separate from the frequency list so typing does not rebuild focused inputs. */
export function renderRecurrenceEndPicker(pop: HTMLElement, opts: {
  rule: string; due?: string | null; scheduled?: string | null;
  onChange: (rule: string) => void;
}): void {
  const end = getRecurrenceEnd(opts.rule);
  let mode = end.mode;
  let rule = opts.rule;
  const group = pop.createEl("fieldset");
  group.className = "bt-recur-end";
  const legend = group.createEl("legend");
  legend.textContent = t("recur_end_title");
  const name = "bt-recur-end-" + ++groupId;

  const row = (value: RecurrenceEnd["mode"], key: string) => {
    const label = group.createEl("label");
    label.className = "bt-recur-end-row";
    const radio = label.createEl("input");
    radio.type = "radio"; radio.name = name; radio.value = value;
    radio.setAttribute("aria-label", t(key));
    radio.checked = mode === value;
    const text = label.createSpan();
    text.textContent = t(key);
    return { label, radio };
  };
  const never = row("never", "recur_end_never");
  const until = row("until", "recur_end_date");
  const date = until.label.createEl("input");
  date.type = "date"; date.className = "bt-recur-end-date";
  date.setAttribute("aria-label", t("recur_end_date"));
  date.value = end.mode === "until" ? end.date : "";
  const countRow = row("count", "recur_end_count");
  const count = countRow.label.createEl("input");
  count.type = "number"; count.className = "bt-recur-end-count";
  count.min = "1"; count.step = "1"; count.max = String(Number.MAX_SAFE_INTEGER);
  count.setAttribute("aria-label", t("recur_end_count"));
  count.value = String(end.mode === "count" ? end.count : 4);
  const hint = group.createDiv();
  hint.className = "bt-pop-hint bt-recur-end-hint";
  const error = group.createDiv();
  error.className = "bt-recur-end-error";
  error.id = name + "-error";
  error.setAttribute("aria-live", "polite");
  date.setAttribute("aria-describedby", error.id);
  count.setAttribute("aria-describedby", error.id);

  const sync = () => {
    never.radio.checked = mode === "never";
    until.radio.checked = mode === "until";
    countRow.radio.checked = mode === "count";
    date.disabled = mode !== "until";
    count.disabled = mode !== "count";
    hint.textContent = mode === "count" ? t("recur_end_count_hint")
      : mode === "until" ? t("recur_end_date_hint") : "";
  };
  const commit = () => {
    const selected: RecurrenceEnd = mode === "count" ? { mode, count: Number(count.value) }
      : mode === "until" ? { mode, date: date.value } : { mode };
    const candidate = setRecurrenceEnd(rule, selected);
    const issue = candidate ? recurrenceEndError(candidate, opts.due, opts.scheduled)
      : mode === "count" ? "recur_end_invalid_count" : "recur_end_invalid_date";
    error.textContent = issue ? t(issue) : "";
    date.setAttribute("aria-invalid", String(!!issue && mode === "until"));
    count.setAttribute("aria-invalid", String(!!issue && mode === "count"));
    if (!candidate || issue) return;
    rule = candidate;
    opts.onChange(candidate);
  };
  for (const { radio } of [never, until, countRow]) {
    radio.onchange = () => {
      mode = radio.value as RecurrenceEnd["mode"];
      error.textContent = "";
      sync();
      if (mode !== "until" || date.value) commit();
      if (mode === "until") date.focus();
      if (mode === "count") count.focus();
    };
  }
  for (const input of [date, count]) {
    input.oninput = commit;
    input.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault(); event.stopPropagation(); commit();
    };
  }
  sync();
}
