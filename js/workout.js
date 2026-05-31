// Workout day-view renderers, extracted from index.html. They share `state`
// and `hooks` via app-context (no callback threading); DOM construction is used
// instead of innerHTML. renderApp orchestration stays in index.html and calls
// these; the day-pill click re-renders via hooks.renderApp.
import { state, hooks, DAYS, DAY_LABELS, todayKey, CD_CHOICE_KEY } from "./app-context.js";
import { isoNow } from "./util.js";

// Tiny DOM builder: el("div", {class, text, href, dataset…}, ...children).
// Keeps the render functions readable without innerHTML.
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

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

// ---- Cool-down ------------------------------------------------------------

// localStorage-ish key for the current (date|day) cool-down log slot.
export function cooldownStateKey() {
  return `${state.workoutDate || ""}|${state.selectedDay || ""}`;
}

function cooldownKeyForDay(day) {
  const label = (day?.label || "").toLowerCase();
  if (label.startsWith("push")) return "push";
  if (label.startsWith("pull")) return "pull";
  if (label.startsWith("legs")) return "legs";
  if (label.includes("upper")) return "upper-hybrid";
  if (label.includes("hybrid")) return "upper-hybrid";
  return "default";
}

function getCooldownLog() {
  const key = cooldownStateKey();
  if (!state.cooldownLog) state.cooldownLog = {};
  if (!state.cooldownLog[key]) {
    const fromSession = state.activeSession?.session?.cooldown;
    state.cooldownLog[key] = fromSession ? {
      type: fromSession.type || null,
      source_key: fromSession.source_key || null,
      fitnessplus_name: fromSession.fitnessplus_name || "",
      completed_at: fromSession.completed_at || null,
    } : { type: null, source_key: null, fitnessplus_name: "", completed_at: null };
  }
  return state.cooldownLog[key];
}

function ytSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query || "")}`;
}

export function renderCooldown(day) {
  const host = document.querySelector("#cooldown-host");
  if (!host) return;
  host.replaceChildren();
  if (!day || !day.exercises?.length) return; // no cool-down on rest days
  const cd = state.cooldowns;
  if (!cd) return;

  const key = cooldownKeyForDay(day);
  const lib = cd.library?.[key] || cd.library?.default;
  const fp = cd.apple_fitness_plus;
  const choice = state.cooldownChoice || "library";
  const dayCooldownText = (day.cooldown || "").trim();
  const cdLog = getCooldownLog();
  const isDone = !!cdLog.completed_at && cdLog.type === choice;

  const card = el("section", { class: "cooldown", id: "cooldown-card" }, el("h3", { text: "🧘 Cool-down" }));

  const libTab = el("button", { type: "button", class: "cd-tab" + (choice === "library" ? " active" : ""), text: "Prescribed cooldown", dataset: { choice: "library" } });
  const fpTab = el("button", { type: "button", class: "cd-tab fitnessplus" + (choice === "fitnessplus" ? " active" : ""), text: "Apple Fitness+", dataset: { choice: "fitnessplus" } });
  card.append(el("div", { class: "cd-tabs" }, libTab, fpTab));

  const trainerNote = () => {
    const tn = el("div", { class: "cd-body" });
    tn.append(el("b", { text: "Trainer note:" }), document.createTextNode(" " + dayCooldownText));
    return tn;
  };

  if (choice === "library") {
    if (lib) {
      card.append(el("div", { class: "cd-duration", text: `~${lib.duration_minutes} min · ${lib.name}` }));
      if (dayCooldownText) { const tn = trainerNote(); tn.style.marginBottom = "8px"; card.append(tn); }
      const body = el("div", { class: "cd-body" });
      for (const m of (lib.moves || [])) {
        const img = m.image_url
          ? el("img", { src: m.image_url, alt: m.move, loading: "lazy" })
          : document.createTextNode("🧘");
        const meta = el("div", { class: "cd-move-meta" }, el("b", { text: m.move }), document.createTextNode(` · ${m.duration}`));
        if (m.cue) meta.append(el("div", { class: "cd-cue", text: m.cue }));
        meta.append(el("div", { class: "cd-pills" },
          el("a", { class: "cd-pill", href: m.video_url || ytSearchUrl(m.video_query || m.move), target: "_blank", rel: "noopener", text: "▶ Watch ↗" })));
        body.append(el("div", { class: "cd-move" }, el("div", { class: "cd-move-img" }, img), meta));
      }
      card.append(body);
    } else if (dayCooldownText) {
      card.append(trainerNote());
    } else {
      card.append(el("div", { class: "cd-body", text: "No cooldown configured for this day." }));
    }
  } else {
    const fpName = cdLog.fitnessplus_name || "";
    if (fp?.mindful_cooldown_url) {
      const b = el("div", { class: "cd-body" },
        document.createTextNode("Open Apple Fitness+ → "), el("b", { text: "Mindful Cooldown" }),
        document.createTextNode(". Filter inside the app for Upper Body / Lower Body / Full Body (5–10 min sessions)."));
      b.append(el("div", {}, el("a", { class: "cd-fp-link", href: fp.mindful_cooldown_url, target: "_blank", rel: "noopener", text: "Open Mindful Cooldown ↗" })));
      if (fp.note) b.append(el("div", { class: "cd-fp-note", text: fp.note }));
      b.append(el("div", { class: "cd-fp-name" },
        el("label", { for: "cd-fp-name-input", text: "Which Apple Fitness+ cooldown did you do?" }),
        el("input", { id: "cd-fp-name-input", type: "text", placeholder: "e.g. Mindful Cooldown · Jessica · 10 min", value: fpName })));
      card.append(b);
    } else {
      card.append(el("div", { class: "cd-body", text: "Apple Fitness+ link not configured." }));
    }
  }

  const completeBtn = el("button", { type: "button", id: "cd-complete-btn", class: "cd-complete-btn" + (isDone ? " done" : ""), text: isDone ? "✓ Cool-down logged" : "Mark cool-down complete" });
  const completeRow = el("div", { class: "cd-complete-row" }, completeBtn);
  if (isDone) {
    const at = new Date(cdLog.completed_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" });
    completeRow.append(el("span", { class: "cd-complete-meta", text: `at ${at}` }));
  }
  card.append(completeRow);
  host.appendChild(card);

  for (const btn of card.querySelectorAll(".cd-tab")) {
    btn.addEventListener("click", () => {
      state.cooldownChoice = btn.dataset.choice;
      localStorage.setItem(CD_CHOICE_KEY, state.cooldownChoice);
      renderCooldown(day);
    });
  }
  const fpInput = card.querySelector("#cd-fp-name-input");
  if (fpInput) {
    fpInput.addEventListener("input", e => { cdLog.fitnessplus_name = e.target.value; hooks.markWorkoutDirty(); });
  }
  const cBtn = card.querySelector("#cd-complete-btn");
  if (cBtn) {
    cBtn.addEventListener("click", () => {
      if (cdLog.completed_at && cdLog.type === choice) {
        cdLog.completed_at = null; cdLog.type = null;
      } else {
        cdLog.type = choice;
        cdLog.source_key = choice === "library" ? key : null;
        cdLog.completed_at = isoNow();
      }
      hooks.markWorkoutDirty();
      renderCooldown(day);
    });
  }
}
