// Recovery-panel renderers, extracted from index.html. The state object and a
// "dirty" callback are passed in (DI); DOM construction is used instead of
// innerHTML. Orchestration (renderRecoveryPanel, submit, hydration, draft I/O)
// stays in index.html and calls these with `state` and markRecoveryDirty.
import { toast } from "./ui.js";

export function ensureRecoveryRounds(state) {
  if (!state.recoveryRounds || !state.recoveryRounds.length) {
    state.recoveryRounds = [
      { sauna_min: 15, plunge_min: 4 },
      { sauna_min: 15, plunge_min: 4 },
      { sauna_min: 15, plunge_min: 4 },
    ];
  }
  return state.recoveryRounds;
}

export function renderRecoverySummary(state) {
  const el = document.querySelector("#rec-summary");
  if (!el) return;
  const rounds = state.recoveryRounds || [];
  const total = rounds.reduce((s, r) => s + (r.sauna_min || 0) + (r.plunge_min || 0), 0);
  const breakdown = rounds.map((r, i) => `R${i + 1}: ${r.sauna_min ?? 0}/${r.plunge_min ?? 0}`).join(" · ");
  el.replaceChildren();
  const b = document.createElement("b");
  b.textContent = "Total:";
  el.append(b, document.createTextNode(` ${rounds.length} rounds, ${total} min  `));
  const span = document.createElement("span");
  span.style.color = "var(--ink-muted)";
  span.textContent = breakdown;
  el.append(span);
}

function numberInput(value, field, placeholder, max) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.inputMode = "numeric";
  inp.min = "0";
  inp.max = max;
  inp.step = "1";
  inp.value = value ?? "";
  inp.dataset.field = field;
  inp.placeholder = placeholder;
  return inp;
}

export function renderRecoveryRounds(state, onDirty = () => {}) {
  const host = document.querySelector("#rec-rounds-host");
  if (!host) return;
  const rounds = ensureRecoveryRounds(state);
  host.replaceChildren();
  rounds.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "round-row";
    row.dataset.idx = String(i);

    const num = document.createElement("span");
    num.className = "rnd-num";
    num.textContent = String(i + 1);

    const sauna = numberInput(r.sauna_min, "sauna", "15", "60");
    const plunge = numberInput(r.plunge_min, "plunge", "4", "30");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "rnd-del";
    del.dataset.action = "del";
    del.title = "Remove round";
    del.textContent = "×";

    sauna.addEventListener("input", e => {
      rounds[i].sauna_min = e.target.value === "" ? null : Number(e.target.value);
      onDirty();
      renderRecoverySummary(state);
    });
    plunge.addEventListener("input", e => {
      rounds[i].plunge_min = e.target.value === "" ? null : Number(e.target.value);
      onDirty();
      renderRecoverySummary(state);
    });
    del.addEventListener("click", () => {
      if (rounds.length <= 1) { toast("At least one round required.", "err"); return; }
      rounds.splice(i, 1);
      onDirty();
      renderRecoveryRounds(state, onDirty);
      renderRecoverySummary(state);
    });

    row.append(num, sauna, plunge, del);
    host.appendChild(row);
  });
}
