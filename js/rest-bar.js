// Sticky rest-timer bar for the workout view. The countdown math + duration
// persistence are pure and unit-tested in rest-timer.js; this module owns the
// DOM, the ticker, and the silent flash. It auto-starts when a set is marked
// Done (wired from js/workout.js) and reads/writes the shared `state` singleton.
import { state } from "./app-context.js";
import {
  REST_PRESETS, formatClock, remainingSeconds, startTimer, loadDuration, saveDuration,
} from "./rest-timer.js";

const PRESET_LABELS = { 60: "1:00", 90: "1:30", 120: "2:00", 180: "3:00" };
let ticker = null;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

function ensureDuration() {
  if (state.restDurationSec == null) state.restDurationSec = loadDuration(localStorage);
  return state.restDurationSec;
}

function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

// Repaint only the live bits (time text + done/flash classes) from state.
function paint() {
  const bar = document.querySelector("#rest-bar-host .rest-bar");
  if (!bar) return;
  const timeEl = bar.querySelector(".rest-time");
  const t = state.restTimer;
  if (!t) {                                   // idle: show the selected duration
    bar.classList.remove("flash", "done");
    if (timeEl) timeEl.textContent = formatClock(ensureDuration());
    return;
  }
  const rem = remainingSeconds(t.endsAtMs, Date.now());
  if (rem > 0) {                              // counting down
    if (timeEl) timeEl.textContent = formatClock(rem);
    bar.classList.remove("flash", "done");
    return;
  }
  if (timeEl) timeEl.textContent = "GO";      // rest is up — held green state
  bar.classList.add("done");
  if (!t.flashed) { bar.classList.add("flash"); t.flashed = true; } // flash once
  stopTicker();
}

export function startRest() {
  state.restTimer = startTimer(ensureDuration(), Date.now());
  renderRestBar(true);
}

export function cancelRest() {
  state.restTimer = null;
  stopTicker();
  renderRestBar(true);
}

export function setRestDuration(sec) {
  state.restDurationSec = sec;
  saveDuration(localStorage, sec);
  startRest();                                // a preset tap also (re)starts
}

// Build/refresh the bar. `active` = currently viewing a workout day with sets.
export function renderRestBar(active) {
  const host = document.querySelector("#rest-bar-host");
  if (!host) return;
  host.replaceChildren();
  if (!active) {
    stopTicker();
    document.body.classList.remove("rest-bar-open");
    return;
  }
  document.body.classList.add("rest-bar-open");
  const selected = ensureDuration();

  const time = el("div", { class: "rest-time", title: "Tap to start / stop rest" });
  time.addEventListener("click", () => (state.restTimer ? cancelRest() : startRest()));

  const presets = el("div", { class: "rest-presets" });
  for (const sec of REST_PRESETS) {
    const chip = el("button", {
      type: "button",
      class: "rest-chip" + (sec === selected ? " active" : ""),
      text: PRESET_LABELS[sec],
    });
    chip.addEventListener("click", () => setRestDuration(sec));
    presets.append(chip);
  }

  host.append(el("div", { class: "rest-bar" }, time, presets));

  const live = state.restTimer && remainingSeconds(state.restTimer.endsAtMs, Date.now()) > 0;
  if (live && !ticker) ticker = setInterval(paint, 250);
  paint();
}
