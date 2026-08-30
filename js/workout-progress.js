export function summarizeWorkoutProgress(day, log = {}) {
  const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
  let completedExercises = 0;
  let completedSets = 0;
  let totalSets = 0;
  for (const exercise of exercises) {
    const storedSets = log?.[exercise.exercise_id]?.sets;
    const sets = Array.isArray(storedSets)
      ? storedSets
      : Array.from({ length: Math.max(0, Number(exercise.target_sets) || 0) }, () => ({ done: false }));
    const doneCount = sets.filter(set => set?.done === true).length;
    completedSets += doneCount;
    totalSets += sets.length;
    if (sets.length > 0 && doneCount === sets.length) completedExercises += 1;
  }
  const totalExercises = exercises.length;
  return {
    completedExercises,
    totalExercises,
    completedSets,
    totalSets,
    text: `${completedExercises}/${totalExercises} exercises · ${completedSets}/${totalSets} sets`,
    ariaLabel: `${completedExercises} of ${totalExercises} exercises; ${completedSets} of ${totalSets} sets complete`,
  };
}
