// CommonJS on purpose: pre-commit installs ESLint and its plugins in its own environment,
// which require() finds via NODE_PATH (ESM imports would not).
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    // Vendored third-party player, kept as shipped (see THIRD_PARTY_NOTICES.md)
    { ignores: ['js/websocket.js'] },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: globals.browser,
        },
    },
    // The plain <script> files share their classes through the global scope
    {
        files: ['js/app.js'],
        languageOptions: {
            globals: {
                Settings: 'readonly',
                LanguageManager: 'readonly',
                Camera: 'readonly',
                PresetManager: 'readonly',
                UIController: 'readonly',
            },
        },
    },
    {
        files: ['js/camera.js'],
        languageOptions: { globals: { Streamedian: 'readonly' } },
    },
];
