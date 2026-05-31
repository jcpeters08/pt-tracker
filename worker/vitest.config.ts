// Worker vitest config — scoped to the Worker's TypeScript tests under test/.
// Without a config here, vitest walks up to the repo-root config
// (include: js/**/*.test.js), which matches nothing in this directory, so
// `npm test` reported "No test files found" and the suite silently never ran.
export default {
  test: {
    include: ["test/**/*.test.ts"],
  },
};
