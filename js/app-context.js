// Shared app context for the render modules.
//
// `state` is the single mutable app-state object (relocated verbatim from
// index.html). Every module that imports it shares the same reference, so
// in-place mutations propagate — this deliberately relaxes pure DI for the
// render layer, whose functions read/write state on nearly every line.
//
// `hooks` is a registry index.html populates at boot with shared callbacks
// (renderApp, markWorkoutDirty, saveWorkoutDraft, …). Render modules call
// `hooks.renderApp()` etc. instead of importing index.html — which would be a
// circular dependency.
export const state = {
  sid: null,
  email: null,
  pat: null,
  routines: [],         // [{id, file}, ...]
  routine: null,        // active routine JSON
  routineMeta: [],      // [{id, name, start_date, end_date}] for auto-pick by date
  exercises: {},        // id → exercise JSON
  cooldowns: null,      // data/cooldowns.json (loaded once)
  recoveryByDate: null, // Map<date, {kind, session, status}>
  selectedDay: null,    // "monday" etc
  workoutDate: null,    // YYYY-MM-DD — defaults to today, user can change via date picker
  sessionLookup: null,  // Map<"date|day|type", { kind, session, status, submitted_at }>
  activeSession: null,  // current view's matching session (or null)
  log: {},              // exercise_id → {sets: [{set, weight_kg, reps, done}], notes}
  sessionNotes: "",
  submitting: false,
  unitPref: "lbs",      // "lbs" | "kg" — display + input unit; storage is always kg
  cooldownChoice: "library", // "library" | "fitnessplus" — per-day, persisted globally
  recoverySubmitting: false,
  lastWorkoutSig: null,    // signature of last successfully submitted workout payload
  lastRecoverySig: null,   // signature of last successfully submitted recovery payload
  // Track which (date|day|type) keys we've already hydrated into state.log so
  // a re-render doesn't clobber the user's in-progress edits.
  hydratedKeys: new Set(),
  pastLogsByDay: null,  // day_of_week → log JSON, populated when viewing a past routine
};

// Populated by index.html at boot (see Object.assign(hooks, {...})).
export const hooks = {};

// Day-of-week constants + helper, shared by index.html and the render modules.
export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const DAY_LABELS = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
export function todayKey() { return DAYS[(new Date().getDay() + 6) % 7]; }
