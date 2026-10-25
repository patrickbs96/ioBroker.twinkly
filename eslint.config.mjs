import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        ignores: ['**/*.d.ts', 'admin/words.js'],
    },
    {
        files: ['main.test.js', 'test/**/*.js'],
        languageOptions: {
            globals: globals.mocha,
        },
    },
];
