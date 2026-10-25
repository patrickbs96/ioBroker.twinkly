import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        ignores: ['**/*.d.ts'],
    },
    {
        files: ['main.test.js', 'test/**/*.js'],
        languageOptions: {
            globals: globals.mocha,
        },
    },
];
