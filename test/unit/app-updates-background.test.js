'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname, '../../extension/js/app-updates.js'), 'utf8');
function harness() {
    const messages = [], saved = [], scheduled = [], alarms = [], badge = [];
    const listeners = [], disconnects = [];
    let busy = false, reloads = 0;
    const event = list => ({ addListener: f => list.push(f), removeListener: f => { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1); } });
    const port = { onMessage: event(listeners), onDisconnect: event(disconnects), postMessage: m => messages.push(m) };
    const chrome = {
        storage: { local: { set: m => saved.push(m), get: (_keys, callback) => callback(saved.at(-1) || {}) } },
        action: { setBadgeText: m => badge.push(m.text) },
        alarms: { get: (_name, callback) => callback(null), create: (name, options) => alarms.push({ name, options }), onAlarm: event([]) },
        runtime: { reload: () => reloads++, onStartup: event([]) }
    };
    const context = vm.createContext({ chrome, Promise, Date, setTimeout: (f, ms) => { scheduled.push({ f, ms }); return scheduled.length; }, clearTimeout() {} });
    vm.runInContext(source, context);
    const client = context.AppUpdates.create({ chrome, getPort: () => port, isBusy: () => busy });
    return { client, messages, saved, scheduled, alarms, badge, listeners,
        setBusy(value) { busy = value; }, get reloads() { return reloads; },
        reply(result) { listeners.slice().forEach(f => f({ action: 'app_update_result', requestId: messages.at(-1).requestId, ...result })); },
        disconnect() { disconnects.slice().forEach(f => f()); } };
}
test('automatic checks schedule daily, save verified availability and show the toolbar badge', async () => {
    const h = harness();
    h.client.initialize();
    assert.equal(h.alarms[0].options.periodInMinutes, 1440);
    const request = h.client.check();
    h.reply({ status: 'available', version: '1.16.0' });
    assert.equal((await request).status, 'available');
    assert.equal(h.saved.at(-1).appUpdate.version, '1.16.0');
    assert.equal(h.badge.at(-1), 'NEW');
    assert.equal(h.reloads, 0);
});
test('installation requires a click, blocks downloads and reloads only after native success', async () => {
    const h = harness();
    h.setBusy(true);
    assert.equal((await h.client.apply('1.16.0')).status, 'error');
    assert.equal(h.messages.length, 0);
    h.setBusy(false);
    const request = h.client.apply('1.16.0');
    assert.equal(h.client.isInstalling(), true);
    assert.equal(h.messages[0].action, 'install_app_update');
    h.reply({ status: 'installed', version: '1.16.0' });
    await request;
    assert.equal(h.reloads, 0);
    h.scheduled.find(t => t.ms === 1200).f();
    assert.equal(h.reloads, 1);
});
test('disconnect and timeout errors release the operation and never reload the extension', async () => {
    const h = harness();
    let request = h.client.apply('1.16.0');
    h.disconnect();
    assert.equal((await request).status, 'error');
    assert.equal(h.client.isInstalling(), false);
    request = h.client.check();
    h.scheduled.at(-1).f();
    assert.equal((await request).status, 'error');
    assert.equal(h.listeners.length, 0);
    assert.equal(h.reloads, 0);
});
