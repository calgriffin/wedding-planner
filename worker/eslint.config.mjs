// One job only: every name the Worker uses must resolve (no-undef). A missing
// import on a rarely hit path is a runtime ReferenceError that neither the
// dry-run bundle nor the test suites catch (#9 redactError). npm test runs it.
import globals from 'globals';

export default [
  { ignores: ['src/assets.js'] }, // generated
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.serviceworker, // fetch, Request, Response, URL, crypto, caches…
        // Workers runtime globals not in the service-worker set.
        HTMLRewriter: 'readonly',
        WebSocketPair: 'readonly',
        scheduler: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-undef': 'error' },
  },
];
