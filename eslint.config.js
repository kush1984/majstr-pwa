import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat ESLint config. The point of having a linter here at all is TWO rules — the
 * app's correctness hinges on both, and neither is catchable by `tsc`:
 *
 *  - `@typescript-eslint/no-floating-promises` — a dropped `await` on `enqueue` /
 *    `flushOutbox` / `ensureAccessToken` silently loses an offline mutation. It
 *    type-checks perfectly; only a type-aware linter sees it.
 *  - `react-hooks/exhaustive-deps` — a stale-closure effect over online/offline
 *    state ships with no warning (a real instance of this is already in the tree).
 *
 * They are errors, not warnings: a warning nobody sees is the same as no rule.
 * Type-aware linting needs `projectService`, so it only runs over the app sources
 * and test files that the tsconfigs actually include.
 */
export default tseslint.config(
  {
    // Build output, deps, and generated assets are not ours to lint.
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // Explicit list, NOT `projectService: true`: the service resolves files through
        // the root tsconfig's references, and tsconfig.test.json is deliberately kept
        // out of those (it still carries a backlog of stale-mock type errors, so
        // referencing it would turn `npm run build` red). Naming the projects here lets
        // the linter type-check test files without coupling them to the build.
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // ---- the two that justify the linter ----------------------------------
      '@typescript-eslint/no-floating-promises': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // `onClick={async () => …}` is idiomatic React (the return value is ignored by
      // design), and flagging it buries the 65 REAL floating promises under 82 false
      // ones. Void-return checking stays on everywhere else — only JSX attributes are
      // exempt, which is what typescript-eslint itself recommends for React.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // ---- noise control ----------------------------------------------------
      // An intentionally-unused binding is spelled with a leading underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The API boundary genuinely deals in `any` (axios errors, parsed JSON);
      // `no-unsafe-*` on top of that is thousands of findings with no bug behind them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `??` vs `||` is a real distinction but not one worth a red build here.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      // `queryFn: authApi.me` — the api modules are plain objects of standalone
      // functions that never touch `this`, so the unbound-`this` hazard this rule
      // guards against cannot occur here. (It stays ON inside tests, where an
      // unbound spy assertion IS a real mistake.)
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  {
    // Tests may fire-and-forget and stub loosely; the two headline rules still apply.
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'e2e-offline/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A mock handler is declared `async` to MATCH a Promise-returning signature,
      // not because its body awaits anything — that is the correct stub, not a smell.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    // Plain JS tooling (this config, build scripts) — Node globals, no type-aware rules.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
