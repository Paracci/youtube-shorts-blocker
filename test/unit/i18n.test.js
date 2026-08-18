'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'i18n', 'translations.js'), 'utf8');

function readTranslationData() {
    const context = {
        URL,
        navigator: { language: 'en-US' },
        chrome: {
            i18n: { getUILanguage: () => 'en-US' },
            storage: { local: { get: (_key, callback) => callback({ userLang: 'en' }), set: (_value, callback) => callback?.() } }
        },
        document: { querySelectorAll: () => [] }
    };
    const result = vm.runInNewContext(`${source}\nJSON.stringify({ supported: SUPPORTED_LANGS, translations: TRANSLATIONS, download: DOWNLOAD_PAGE_TRANSLATIONS })`, context, {
        filename: 'translations.js'
    });
    return JSON.parse(result);
}

test('all supported languages have the same base and downloader key sets', () => {
    const data = readTranslationData();
    assert.deepEqual(data.supported, ['en', 'tr', 'de', 'fr', 'es', 'pt', 'it', 'ru', 'ja', 'ko', 'zh']);
    assert.deepEqual(Object.keys(data.translations).sort(), [...data.supported].sort());

    const baseKeys = new Set(Object.keys(data.translations.en));
    const downloadKeys = new Set(Object.keys(data.download.en));
    data.supported.forEach(language => {
        assert.deepEqual(new Set(Object.keys(data.translations[language])), baseKeys, language);
        assert.deepEqual(new Set(Object.keys(data.download[language])), downloadKeys, language);
    });
});

test('job panel labels are translated in every language', () => {
    const data = readTranslationData();
    const required = [
        'downloadJobsCollapse',
        'downloadJobsExpand',
        'downloadJobsActive',
        'downloadCancel',
        'downloadRetry'
    ];

    data.supported.forEach(language => {
        required.forEach(key => {
            const value = data.download[language][key];
            assert.equal(typeof value, 'string', `${language}.${key}`);
            assert.ok(value.trim().length > 0, `${language}.${key}`);
        });
    });

    const english = data.download.en;
    data.supported.filter(language => language !== 'en').forEach(language => {
        required.slice(0, 1).forEach(key => {
            assert.notEqual(data.download[language][key], english[key], `${language}.${key} fell back to English`);
        });
    });
});

test('Chrome locale message files are valid and complete for manifest metadata', () => {
    const localeDirectories = fs.readdirSync(path.join(repoRoot, 'extension', '_locales'), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
    assert.deepEqual(localeDirectories, ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh_CN']);

    localeDirectories.forEach(directory => {
        const messages = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension', '_locales', directory, 'messages.json'), 'utf8'));
        assert.equal(typeof messages.extensionName?.message, 'string', `${directory}.extensionName`);
        assert.equal(typeof messages.extensionDescription?.message, 'string', `${directory}.extensionDescription`);
    });
});
