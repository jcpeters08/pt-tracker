// Pure helpers for keeping the workout dock anchored to the *visual* viewport.
//
// iOS Safari (measured on iOS 27.1, Safari and home-screen PWA) does not shrink the layout viewport when
// the software keyboard opens: `position: fixed; bottom: 0` stays anchored to
// the layout viewport, which Safari then offsets to keep the focused input in
// view — so the dock ends up behind the keyboard and "floats" as you scroll.
// `window.visualViewport` reports the part of the layout viewport that is
// actually visible; the gap between the two is the keyboard inset.

// Visual-viewport shrinkage below this (CSS px) is treated as "keyboard open".
// Toolbar show/hide and rounding never reach it; the iOS keyboard is 250px+.
export const KEYBOARD_INSET_THRESHOLD = 80;

const TEXT_INPUT_TYPES = new Set([
  "text", "number", "search", "email", "url", "tel", "password", "decimal",
]);

/**
 * Keyboard inset in CSS px: how far the visual viewport's bottom edge sits
 * above the layout viewport's bottom edge. 0 when the keyboard is closed.
 * Pinch-zoom also shrinks the visual viewport; `scale` != 1 means the user is
 * zoomed, not typing, so the inset is reported as 0 and the dock stays put.
 */
export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0, vvScale = 1 }) {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(vvHeight)) return 0;
  if (Number.isFinite(vvScale) && Math.abs(vvScale - 1) > 0.01) return 0;
  const inset = innerHeight - vvHeight - (Number.isFinite(vvOffsetTop) ? vvOffsetTop : 0);
  return Math.max(0, Math.round(inset));
}

export function isKeyboardOpen(inset, threshold = KEYBOARD_INSET_THRESHOLD) {
  return Number.isFinite(inset) && inset >= threshold;
}

/** True for elements whose focus summons a text keyboard on a touch device. */
export function isTextEntry(el) {
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = String(el.type || "text").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return el.isContentEditable === true;
}
