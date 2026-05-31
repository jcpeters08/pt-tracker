// Workout day-view renderers, extracted from index.html. They share `state`
// and `hooks` via app-context (no callback threading); DOM construction is used
// instead of innerHTML. renderApp orchestration stays in index.html and calls
// these; the day-pill click re-renders via hooks.renderApp.
import { state, hooks, DAYS, DAY_LABELS, todayKey } from "./app-context.js";

// Short label for a day pill: the routine day's label sans parenthetical, or
// "Workout"/"Rest" depending on whether the day has exercises.
export function dayLabel(key) {
  const day = state.routine?.days?.[key];
  return day?.label?.split("(")[0]?.trim() || (day?.exercises?.length ? "Workout" : "Rest");
}

export function renderDayToggle() {
  const today = todayKey();
  const host = document.querySelector("#day-toggle");
  if (!host) return;
  host.replaceChildren();
  for (const key of DAYS) {
    const day = state.routine?.days?.[key];
    const hasExercises = !!(day?.exercises?.length);
    const btn = document.createElement("button");
    btn.className = "day-pill";
    if (key === state.selectedDay) btn.classList.add("active");
    if (key === today) btn.classList.add("today");
    if (!hasExercises) btn.classList.add("rest");
    btn.append(document.createTextNode(DAY_LABELS[key]));
    const lab = document.createElement("span");
    lab.className = "day-label";
    lab.textContent = hasExercises ? dayLabel(key) : "—";
    btn.append(lab);
    btn.addEventListener("click", () => {
      state.selectedDay = key;
      // Clear in-progress edits so cards re-hydrate from whatever's logged
      // (or routine targets) for the newly-selected day.
      state.log = {};
      hooks.renderApp();
    });
    host.appendChild(btn);
  }
}
