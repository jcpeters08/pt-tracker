// Accessible rest-timer UI. Countdown math and persistence live in rest-timer.js.
import { state } from "./app-context.js";
import {
  REST_PRESETS,
  formatClock,
  remainingSeconds,
  startTimer,
  loadDuration,
  saveDuration,
  loadRunningTimer,
  saveRunningTimer,
  clearRunningTimer,
} from "./rest-timer.js";

const PRESET_LABELS = { 60: "1:00", 90: "1:30", 120: "2:00", 180: "3:00" };
let ticker = null;

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

function ensureDuration() {
  if (state.restDurationSec == null) state.restDurationSec = loadDuration(localStorage);
  return state.restDurationSec;
}

function ensureTimerHydrated() {
  if (state.restTimerHydrated) return;
  state.restTimer = loadRunningTimer(localStorage, Date.now());
  if (state.restTimer) state.restDurationSec = state.restTimer.durationSec;
  state.restTimerHydrated = true;
}

function stopTicker() {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
}

function announce(message) {
  const live = document.querySelector("#rest-status-live");
  if (live) live.textContent = message;
}

function syncPresetState(bar) {
  const selected = ensureDuration();
  for (const chip of bar.querySelectorAll(".rest-chip")) {
    const active = Number(chip.dataset.seconds) === selected;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function paint() {
  const bar = document.querySelector("#rest-bar-host .rest-bar");
  if (!bar) return;
  const time = bar.querySelector(".rest-time");
  const duration = ensureDuration();
  const timer = state.restTimer;
  if (!timer) {
    bar.classList.remove("flash", "done");
    time.textContent = formatClock(duration);
    time.setAttribute("aria-label", `Start ${duration}-second rest timer`);
    return;
  }
  const remaining = remainingSeconds(timer.endsAtMs, Date.now());
  if (remaining > 0) {
    bar.classList.remove("flash", "done");
    time.textContent = formatClock(remaining);
    time.setAttribute("aria-label", `Stop rest timer, ${remaining} seconds remaining`);
    return;
  }
  time.textContent = "GO";
  time.setAttribute("aria-label", `Rest complete; start ${duration}-second timer`);
  bar.classList.add("done");
  if (!timer.flashed) {
    bar.classList.add("flash");
    timer.flashed = true;
    clearRunningTimer(localStorage);
    announce("Rest complete");
  }
  stopTicker();
}

function buildRestBar() {
  const time = el("button", {
    type: "button",
    class: "rest-time",
    title: "Start or stop rest timer",
  });
  time.addEventListener("click", () => {
    const running = state.restTimer && remainingSeconds(state.restTimer.endsAtMs, Date.now()) > 0;
    if (running) cancelRest();
    else startRest();
  });

  const presets = el("div", { class: "rest-presets" });
  for (const seconds of REST_PRESETS) {
    const chip = el("button", {
      type: "button",
      class: "rest-chip",
      text: PRESET_LABELS[seconds],
      "aria-label": `Start a ${seconds}-second rest timer`,
      "aria-pressed": "false",
    });
    chip.dataset.seconds = String(seconds);
    chip.addEventListener("click", () => setRestDuration(seconds));
    presets.append(chip);
  }

  const live = el("span", {
    id: "rest-status-live",
    class: "sr-only",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  return el("div", { class: "rest-bar" }, time, presets, live);
}

export function startRest() {
  ensureTimerHydrated();
  state.restTimer = startTimer(ensureDuration(), Date.now());
  saveRunningTimer(localStorage, state.restTimer);
  renderRestBar(true);
  announce("Rest started");
}

export function cancelRest() {
  state.restTimer = null;
  clearRunningTimer(localStorage);
  stopTicker();
  renderRestBar(true);
  announce("Rest stopped");
}

export function setRestDuration(seconds) {
  state.restDurationSec = seconds;
  saveDuration(localStorage, seconds);
  startRest();
}

export function renderRestBar(active) {
  const host = document.querySelector("#rest-bar-host");
  if (!host) return;
  if (!active) {
    stopTicker();
    return;
  }
  ensureTimerHydrated();
  let bar = host.querySelector(".rest-bar");
  if (!bar) {
    bar = buildRestBar();
    host.append(bar);
  }
  syncPresetState(bar);
  const live = state.restTimer && remainingSeconds(state.restTimer.endsAtMs, Date.now()) > 0;
  if (live && !ticker) ticker = setInterval(paint, 250);
  paint();
}
