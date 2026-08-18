'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'extension', 'js', 'developer-logger.js'),
    'utf8'
);

function makeHarness(enabled = false) {
    const messages = [];
    const context = {
        chrome: {
            storage: {
                local: {
                    get(_key, callback) { callback({ developerMode: enabled }); },
                    set(value, callback) { enabled = value.developerMode === true; callback?.(); }
                },
                onChanged: { addListener() {} }
            },
            runtime: {
                sendMessage(message, callback) { messages.push(message); callback?.(); },
                lastError: null
            }
        }
    };
    vm.runInNewContext(source, context, { filename: 'developer-logger.js' });
    return { logger: context.DeveloperLogger, messages };
}

test('developer logger is a no-op while disabled and sends bounded records when enabled', () => {
    const harness = makeHarness(false);
    const logger = harness.logger.create('content', 'test');
    logger.info('test.event', 'ignored');
    assert.equal(harness.messages.length, 0);

    logger.log('invalid', 'test.event', 'ignored');
    assert.equal(harness.messages.length, 0);

    logger.info('test.event', 'stored', { extra: true }, { videoId: 'abc12345678' });
    assert.equal(harness.messages.length, 0);

    harness.logger.setEnabled(true);
    logger.error('test.failed', 'stored', 'details');
    assert.equal(harness.messages.length, 1);
    assert.equal(harness.messages[0].action, 'developer_log');
    assert.equal(harness.messages[0].entry.scope, 'content');
    assert.equal(harness.messages[0].entry.level, 'error');
});
