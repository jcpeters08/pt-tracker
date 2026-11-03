import { test, expect } from "@playwright/test";

const prescription = "Easy walk 3 minutes. Keep the left arm relaxed; no loaded arm stretches.";

// Exercise the real renderer in a browser DOM, independent of changing weekly
// plans and authentication. Only the host page and app orchestration are fixtures.
async function showCooldown(page, cooldown = prescription) {
  await page.route("**/cooldown-test.html", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><div id="cooldown-host"></div>',
  }));
  await page.goto("/cooldown-test.html");
  await page.evaluate(async text => {
    const { state, hooks } = await import("/js/app-context.js");
    const { renderCooldown } = await import("/js/workout.js");
    Object.assign(state, {
      routine: { id: "injury-week" },
      workoutDate: "2026-11-03",
      selectedDay: "tuesday",
      activeSession: null,
      cooldownLog: {},
      cooldownChoice: "library",
      cooldowns: {
        library: {
          legs: {
            name: "Standard leg stretches",
            duration_minutes: 8,
            moves: [{ move: "Hands-on-wall calf stretch", duration: "30 seconds", cue: "Push into the wall" }],
          },
        },
        apple_fitness_plus: { mindful_cooldown_url: "https://fitness.apple.com/" },
      },
    });
    hooks.getRoutineMode = () => "current";
    hooks.markWorkoutDirty = () => {};
    renderCooldown({ label: "Lower body", cooldown: text, exercises: [{ exercise_id: "seated-leg-curl" }] });
  }, cooldown);
}

test("a prescribed cooldown replaces generic library stretches", async ({ page }) => {
  await showCooldown(page);
  await expect(page.locator("#cooldown-card")).toContainText(prescription);
  expect(await page.locator(".cd-move").count()).toBe(0);
  expect(await page.locator(".cd-duration").count()).toBe(0);
});

test("the prescription stays visible when switching to Apple Fitness+", async ({ page }) => {
  await showCooldown(page);
  await page.locator('[data-choice="fitnessplus"]').click();
  await expect(page.locator(".cd-fp-link")).toBeVisible();
  expect(await page.locator("#cooldown-card").textContent()).toContain(prescription);
});

test("completing a custom cooldown records its routine source and survives re-render", async ({ page }) => {
  await showCooldown(page);
  await page.locator("#cd-complete-btn").click();
  const saved = await page.evaluate(async () => {
    const { state } = await import("/js/app-context.js");
    return state.cooldownLog["2026-11-03|tuesday"];
  });
  expect(saved).toMatchObject({ type: "library", source_key: "routine:injury-week:tuesday" });
  expect(saved.completed_at).toBeTruthy();
  await page.locator('[data-choice="fitnessplus"]').click();
  await page.locator('[data-choice="library"]').click();
  await expect(page.locator("#cd-complete-btn")).toHaveText("✓ Cool-down logged");
  await page.locator("#cd-complete-btn").click();
  await expect(page.locator("#cd-complete-btn")).toHaveText("Mark cool-down complete");
});

test("a blank prescription keeps the library fallback and source identity", async ({ page }) => {
  await showCooldown(page, "  ");
  await expect(page.locator(".cd-move")).toContainText("Hands-on-wall calf stretch");
  await expect(page.locator(".cd-duration")).toContainText("Standard leg stretches");
  await page.locator("#cd-complete-btn").click();
  expect(await page.evaluate(async () => {
    const { state } = await import("/js/app-context.js");
    return state.cooldownLog["2026-11-03|tuesday"].source_key;
  })).toBe("legs");
});
