/**
 * Scoped lint config for the unified player work.
 *
 * Deliberately NOT named `.eslintrc*`: the rest of the repo has never been
 * linted, and a repo-wide config would hijack `next build` with thousands of
 * legacy findings. Run it against the player surface with `npm run lint:player`.
 */
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  rules: {
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
    'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
  },
  overrides: [
    {
      files: ['tests/**/*.js', '*.config.*s', 'next.config.mjs'],
      rules: { 'no-undef': 'off' },
    },
  ],
};
