const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { JSDOM } = require('jsdom');

function renderConfigPanelHtml() {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'vscode') return {};
        return originalLoad(request, parent, isMain);
    };

    try {
        const { ConfigPanel } = require('../out/configPanel');
        return ConfigPanel.prototype.getHtml.call({ getNonce: () => 'testnonce' });
    } finally {
        Module._load = originalLoad;
    }
}

test('configuration panel webview interactions work', () => {
    const html = renderConfigPanelHtml();
    const scriptMatch = html.match(/<script nonce="testnonce">([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'rendered webview script should exist');
    assert.match(html, /script-src 'nonce-testnonce'/);
    assert.doesNotMatch(scriptMatch[1], /\b(?:const|let)\b/);

    const messages = [];
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    dom.window.acquireVsCodeApi = () => ({ postMessage: message => messages.push(message) });
    dom.window.eval(scriptMatch[1]);

    const document = dom.window.document;
    const dispatch = (id, eventName) => {
        document.getElementById(id).dispatchEvent(new dom.window.Event(eventName, { bubbles: true }));
    };

    dispatch('btnModeUrl', 'click');
    assert.equal(document.getElementById('groupTenant').style.display, 'none');
    assert.equal(document.getElementById('groupUrl').style.display, '');

    const capturePrompts = document.getElementById('capturePrompts');
    capturePrompts.checked = true;
    dispatch('capturePrompts', 'change');
    assert.equal(document.getElementById('evalsEnabled').disabled, false);
    assert.equal(document.getElementById('evalsEnabledTab').disabled, false);

    dispatch('tabBtnColetor', 'click');
    assert.ok(document.getElementById('paneColetor').classList.contains('active'));
    assert.ok(messages.some(message => message.command === 'getCollectorStatus'));

    dispatch('tabBtnEvals', 'click');
    assert.ok(document.getElementById('paneEvals').classList.contains('active'));
    assert.ok(!document.getElementById('paneColetor').classList.contains('active'));
});
