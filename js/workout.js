// Workout day-view renderers, extracted from index.html. They share `state`
// and `hooks` via app-context (no callback threading); DOM construction is used
// instead of innerHTML. renderApp orchestration stays in index.html and calls
// these; the day-pill click re-renders via hooks.renderApp.
import { state, hooks, DAYS, DAY_LABELS, todayKey, CD_CHOICE_KEY } from "./app-context.js";
import { isoNow, kgToLbs, lbsToKg, roundTo, fmtNum } from "./util.js";
import { openHowto, openVideo, openLightbox } from "./ui.js";

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
      // Clear in-progress edits so cards re-hydrate for the newly-selected day.
      // refreshActiveSession resolves the session by exact date, then falls back
      // to the day-of-week's log within the routine week — so a workout you did
      // on a different date (a catch-up) still shows up when you tap that day.
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

// ---- Exercise cards -------------------------------------------------------

// Display a stored kg weight in the user's preferred unit (blank for 0/null).
function displayWeight(kg) {
  if (kg == null || kg === 0) return "";
  if (state.unitPref === "lbs") return String(Math.round(kgToLbs(kg)));
  return fmtNum(kg, 1);
}

// Convert an input value (in the user's pref unit) → kg for storage.
function inputToKg(val) {
  if (val === "" || val == null) return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  return state.unitPref === "lbs" ? lbsToKg(n) : n;
}

// Dual-unit target text from a routine entry: "30 lbs (14 kg) × 12 × 3".
function formatTargetText(ex) {
  if (ex.target_weight_kg == null) {
    return `${ex.target_weight_raw || "?"} × ${ex.target_reps || "?"} × ${ex.target_sets || "?"}`;
  }
  const kg = ex.target_weight_kg;
  if (kg === 0) {
    return `bodyweight × ${ex.target_reps || "?"} × ${ex.target_sets || "?"}`;
  }
  const lbs = roundTo(kgToLbs(kg), 0);
  const kgRounded = roundTo(kg, 1);
  const lbsStr = `${fmtNum(lbs, 0)} lbs`;
  const kgStr = `${fmtNum(kgRounded, 1)} kg`;
  const primary = state.unitPref === "lbs" ? lbsStr : kgStr;
  const secondary = state.unitPref === "lbs" ? kgStr : lbsStr;
  return `${primary} (${secondary}) × ${ex.target_reps || "?"} × ${ex.target_sets || "?"}`;
}

// Step value for weight inputs. PF dumbbells go 5 lb; kg side stays 0.5 kg.
function weightInputStep() {
  return state.unitPref === "lbs" ? "5" : "0.5";
}

// "actual: 135 lbs × 8, …" line for a past-routine log (read-only view).
function buildActualText(log, exerciseId) {
  if (!log) return "actual: —";
  const ex = (log.exercises || []).find(e => e.exercise_id === exerciseId);
  if (!ex || !Array.isArray(ex.sets) || !ex.sets.length) return "actual: —";
  const parts = ex.sets.map(s => {
    const lbs = s.weight_kg != null ? Math.round(kgToLbs(s.weight_kg)) : "?";
    return `${lbs} lbs × ${s.reps ?? "?"}`;
  });
  return "actual: " + parts.join(", ");
}

// Lazily create (or prefill from a saved session) the in-progress log slot.
export function ensureLogState(exId, targetWeight, targetReps, targetSets) {
  if (state.log[exId]) return state.log[exId];
  // If there's an existing session for the current view, prefill from it
  // (sets carry their logged weight/reps and are marked Done).
  const active = state.activeSession;
  if (active && active.kind === "log") {
    const logged = (active.session?.exercises || []).find(e => e.exercise_id === exId);
    if (logged) {
      const sets = (logged.sets || []).map(s => ({
        weight_kg: s.weight_kg ?? null,
        reps: s.reps ?? null,
        done: true,                   // it's in the saved log → it counted
      }));
      state.log[exId] = { sets, notes: logged.notes || "" };
      return state.log[exId];
    }
  }
  const sets = [];
  for (let i = 0; i < (targetSets || 1); i++) {
    sets.push({ weight_kg: targetWeight ?? null, reps: targetReps ?? null, done: false });
  }
  state.log[exId] = { sets, notes: "" };
  return state.log[exId];
}

export function renderExerciseCard(exDef, ex) {
  const meta = state.exercises[ex.exercise_id] || {};
  const log = ensureLogState(ex.exercise_id, ex.target_weight_kg, ex.target_reps, ex.target_sets);
  const muscles = [meta.primary_muscle, ...(meta.secondary_muscles || [])].filter(Boolean).join(" · ");
  const targetText = formatTargetText(ex);
  const unitLabel = state.unitPref;
  const step = weightInputStep();

  // image (or emoji fallback)
  const imgInner = meta.image_url
    ? el("img", { src: meta.image_url, alt: meta.name || ex.exercise_id, loading: "lazy" })
    : document.createTextNode("🏋️");
  const exImg = el("div", { class: "ex-img" }, imgInner);

  // target line — tappable; user data via textContent + dataset (no innerHTML)
  const targetDiv = el("div", { class: "target" }, el("b", { text: "Target:" }), document.createTextNode(" "));
  const targetLine = el("span", {
    class: "target-line",
    text: targetText,
    dataset: {
      routineId: exDef.id || "",
      day: state.selectedDay || "",
      exerciseId: ex.exercise_id,
      weightKg: ex.target_weight_kg ?? 0,
      weightRaw: ex.target_weight_raw ?? "",
      reps: ex.target_reps ?? 0,
      sets: ex.target_sets ?? 0,
    },
  });
  targetDiv.append(targetLine);
  if (ex.notes) {
    targetDiv.append(document.createTextNode(" · "));
    const ns = el("span", { text: ex.notes });
    ns.style.color = "var(--ink-muted)";
    targetDiv.append(ns);
  }
  if (hooks.getRoutineMode(state.routine) === "past") {
    const pastLog = state.pastLogsByDay?.[state.selectedDay];
    targetDiv.append(el("div", { class: "actual-line", text: buildActualText(pastLog, ex.exercise_id) }));
  }

  // pills (video / how-to / external link)
  const pillRow = el("div", { class: "pill-row" });
  if (meta.video_id) {
    pillRow.append(el("button", { class: "pill video", type: "button", dataset: { action: "play-video" }, text: "▶ Watch demo" }));
  } else if (meta.video_url) {
    pillRow.append(el("a", { class: "pill video", href: meta.video_url, target: "_blank", rel: "noopener", text: "▶ Watch demo" }));
  }
  if (meta.instructions?.length || meta.form_cues?.length) {
    pillRow.append(el("button", { class: "pill", type: "button", dataset: { action: "show-howto" }, text: "ℹ How to" }));
  }
  if (meta.info_url) {
    pillRow.append(el("a", { class: "pill", href: meta.info_url, target: "_blank", rel: "noopener", text: "↗ M&S" }));
  }

  const exMeta = el("div", { class: "ex-meta" },
    el("h3", { text: meta.name || ex.exercise_id }),
    el("div", { class: "muscles", text: muscles }),
    targetDiv,
    pillRow,
  );

  // set list (header row + one row per logged set)
  const setList = el("div", { class: "set-list" },
    el("div", { class: "set-row set-header" },
      el("span", { class: "set-num", text: "#" }),
      el("span", { class: "col-label", text: `Weight (${unitLabel})` }),
      el("span", { class: "col-label", text: "Reps" }),
      el("span"),
    ),
  );
  log.sets.forEach((s, i) => {
    setList.append(el("div", { class: "set-row" + (s.done ? " done" : ""), dataset: { set: String(i) } },
      el("span", { class: "set-num", text: String(i + 1) }),
      el("input", { type: "number", inputmode: "decimal", step, placeholder: unitLabel, value: displayWeight(s.weight_kg), dataset: { field: "weight" } }),
      el("input", { type: "number", inputmode: "numeric", step: "1", placeholder: "reps", value: s.reps ?? "", dataset: { field: "reps" } }),
      el("button", { class: "done-btn", dataset: { action: "done" }, text: s.done ? "✓ Done" : "Done" }),
    ));
  });

  const exBody = el("div", { class: "ex-body" },
    setList,
    el("button", { class: "add-set", dataset: { action: "add-set" }, text: "+ Add set" }),
    el("textarea", { class: "ex-notes", placeholder: "Notes for this exercise…", value: log.notes }),
  );

  return el("section", { class: "ex-card", dataset: { exid: ex.exercise_id } },
    el("div", { class: "ex-head" }, exImg, exMeta),
    exBody,
  );
}

function bindCardEvents(card, exId) {
  const log = state.log[exId];
  const meta = state.exercises[exId] || {};
  // Lightbox on image tap
  const imgWrap = card.querySelector(".ex-img");
  if (meta.image_url) {
    imgWrap.addEventListener("click", () => openLightbox(meta.image_url, meta.name || exId));
  } else {
    imgWrap.style.cursor = "default";
  }
  // Inline video player
  const playBtn = card.querySelector('[data-action="play-video"]');
  if (playBtn && meta.video_id) {
    playBtn.addEventListener("click", () => openVideo(meta.video_id, meta.name || exId));
  }
  // How-to inline modal
  const howtoBtn = card.querySelector('[data-action="show-howto"]');
  if (howtoBtn) howtoBtn.addEventListener("click", () => openHowto(meta));
  // Per-set inputs
  card.querySelectorAll(".set-row:not(.set-header)").forEach(row => {
    const idx = Number(row.dataset.set);
    row.querySelector('input[data-field="weight"]').addEventListener("input", e => {
      const kg = inputToKg(e.target.value);
      log.sets[idx].weight_kg = kg == null ? null : roundTo(kg, 2);
      hooks.markWorkoutDirty();
    });
    row.querySelector('input[data-field="reps"]').addEventListener("input", e => {
      log.sets[idx].reps = e.target.value === "" ? null : Number(e.target.value);
      hooks.markWorkoutDirty();
    });
    row.querySelector('[data-action="done"]').addEventListener("click", () => {
      log.sets[idx].done = !log.sets[idx].done;
      row.classList.toggle("done", log.sets[idx].done);
      row.querySelector('[data-action="done"]').textContent = log.sets[idx].done ? "✓ Done" : "Done";
      hooks.markWorkoutDirty();
    });
  });
  card.querySelector('[data-action="add-set"]').addEventListener("click", () => {
    const last = log.sets[log.sets.length - 1] || {};
    log.sets.push({ weight_kg: last.weight_kg ?? null, reps: last.reps ?? null, done: false });
    hooks.markWorkoutDirty();
    hooks.renderApp();
  });
  card.querySelector(".ex-notes").addEventListener("input", e => {
    log.notes = e.target.value;
    hooks.markWorkoutDirty();
  });
}

export function renderExercises() {
  const host = document.querySelector("#exercises-host");
  if (!host) return;
  host.replaceChildren();
  const day = state.routine?.days?.[state.selectedDay];
  if (!day || !day.exercises?.length) {
    host.append(el("div", { class: "rest-day-msg" },
      document.createTextNode("Rest day — no scheduled exercises."),
      el("br"),
      document.createTextNode("Use the day toggle to see another day."),
    ));
    document.querySelector("#session-notes-host")?.classList.add("hidden");
    document.querySelector("#submit-row")?.classList.add("hidden");
    return;
  }
  for (const ex of day.exercises) {
    const card = renderExerciseCard(state.routine, ex);
    host.appendChild(card);
    bindCardEvents(card, ex.exercise_id);
  }
  document.querySelector("#session-notes-host")?.classList.remove("hidden");
  document.querySelector("#submit-row")?.classList.remove("hidden");
}
