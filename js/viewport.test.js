import { describe, it, expect } from "vitest";
import { KEYBOARD_INSET_THRESHOLD, keyboardInset, isKeyboardOpen, isTextEntry } from "./viewport.js";

describe("keyboardInset", () => {
  it("is 0 when the visual viewport matches the layout viewport", () => {
    expect(keyboardInset({ innerHeight: 812, vvHeight: 812, vvOffsetTop: 0, vvScale: 1 })).toBe(0);
  });

  it("is the keyboard height when the visual viewport shrinks from the bottom", () => {
    expect(keyboardInset({ innerHeight: 812, vvHeight: 512, vvOffsetTop: 0, vvScale: 1 })).toBe(300);
  });

  it("accounts for the visual viewport being scrolled within the layout viewport", () => {
    // Safari offsets the layout viewport to keep the focused input in view:
    // the visible bottom edge is offsetTop + height, not just height.
    expect(keyboardInset({ innerHeight: 812, vvHeight: 472, vvOffsetTop: 40, vvScale: 1 })).toBe(300);
  });

  it("never goes negative and rounds subpixel values", () => {
    expect(keyboardInset({ innerHeight: 812, vvHeight: 820, vvOffsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 812, vvHeight: 511.6, vvOffsetTop: 0 })).toBe(300);
  });

  it("ignores pinch-zoom shrinkage (scale != 1)", () => {
    expect(keyboardInset({ innerHeight: 812, vvHeight: 406, vvOffsetTop: 100, vvScale: 2 })).toBe(0);
  });

  it("still measures the visible edge when zoomed if a text field is focused (ignoreZoom)", () => {
    // Zoomed 2x, keyboard up: the visible region ends 506px into the layout viewport.
    expect(keyboardInset({ innerHeight: 812, vvHeight: 406, vvOffsetTop: 100, vvScale: 2, ignoreZoom: true })).toBe(306);
    // Zoomed with the visible edge at the layout bottom → nothing to lift.
    expect(keyboardInset({ innerHeight: 812, vvHeight: 406, vvOffsetTop: 406, vvScale: 2, ignoreZoom: true })).toBe(0);
    // ignoreZoom changes nothing at scale 1.
    expect(keyboardInset({ innerHeight: 812, vvHeight: 512, vvOffsetTop: 0, vvScale: 1, ignoreZoom: true })).toBe(300);
  });

  it("defaults offsetTop and scale and tolerates missing numbers", () => {
    expect(keyboardInset({ innerHeight: 812, vvHeight: 600 })).toBe(212);
    expect(keyboardInset({ innerHeight: NaN, vvHeight: 600 })).toBe(0);
    expect(keyboardInset({ innerHeight: 812, vvHeight: undefined })).toBe(0);
  });
});

describe("isKeyboardOpen", () => {
  it("treats small insets (toolbars, rounding) as closed and keyboard-sized insets as open", () => {
    expect(isKeyboardOpen(0)).toBe(false);
    expect(isKeyboardOpen(KEYBOARD_INSET_THRESHOLD - 1)).toBe(false);
    expect(isKeyboardOpen(KEYBOARD_INSET_THRESHOLD)).toBe(true);
    expect(isKeyboardOpen(300)).toBe(true);
    expect(isKeyboardOpen(NaN)).toBe(false);
  });
});

describe("isTextEntry", () => {
  const el = (tagName, extra = {}) => ({ tagName, ...extra });

  it("recognises inputs and textareas that summon a text keyboard", () => {
    expect(isTextEntry(el("INPUT", { type: "number" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "" }))).toBe(true);
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("ignores controls that open pickers or nothing at all", () => {
    expect(isTextEntry(el("INPUT", { type: "date" }))).toBe(false);
    expect(isTextEntry(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(el("DIV"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
  });
});
