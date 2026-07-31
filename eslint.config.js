import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Lint rules are deliberately few and load-bearing.
 *
 * The compiler already enforces most of what a large rule set would, and a wall of stylistic
 * warnings trains people to ignore the output. What is here catches the classes of mistake that
 * have actually cost this project time.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Underscore-prefixed args are the documented convention for base-class signatures that
      // subclasses must be able to widen.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` erases exactly the guarantees the simulation depends on.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Servers, scripts and dev tooling legitimately log to stdout.
    files: ['server/**', 'scripts/**', 'src/dev/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
);
