// Root vitest config — scoped to the frontend pure-helper tests in js/.
// (The Worker has its own vitest project under worker/.)
export default {
  test: {
    include: ["js/**/*.test.js"],
  },
};
