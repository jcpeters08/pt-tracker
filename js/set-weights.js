// Set-weight fill-down. Pure: mutates only the `sets` array it is given.
//
// W47 (2026-11-17..20): Jonathan changed set 1's weight, then tapped Done on
// sets 2–3 without retyping, and the app submitted the routine target he had
// not lifted (lateral raise 10/15/15 lbs for a real 10/10/10). Typing a set's
// weight now carries it to the later sets of that exercise, Done or not, up to
// the first one whose weight the user entered (`weight_edited`). That set
// starts its own run, so drop sets like 110/130/130 survive in any edit order.
// The flag lives on the set in state.log, so the workout draft persists it.
//
// Returns the indexes of the later sets whose weight was carried.
export function applySetWeightEdit(sets, index, weightKg) {
  const edited = sets[index];
  if (!edited) return [];
  edited.weight_kg = weightKg;
  edited.weight_edited = true;
  // A cleared field (mid-retype) is not a weight to copy.
  if (weightKg == null) return [];
  const carried = [];
  for (let i = index + 1; i < sets.length && !sets[i].weight_edited; i++) {
    sets[i].weight_kg = weightKg;
    carried.push(i);
  }
  return carried;
}
