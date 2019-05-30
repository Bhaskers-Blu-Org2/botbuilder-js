const { Configurable, TextPrompt, Dialog, DialogManager } = require('botbuilder-dialogs');
const { AdaptiveDialog } = require('botbuilder-dialogs-adaptive');
const { MemoryStorage, TestAdapter } = require('botbuilder-core');
const { FileResource, FileResourceProvider } = require('../lib');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('FileResourceProvider', function () {
    this.timeout(5000);

    it('FileResourceProvider load multi-level directory, get by id', async function () {
        let resourceProvider = new FileResourceProvider();
        resourceProvider.registerDirectory('tests/resources');

        let simplePromptResource = await resourceProvider.getResource('SimplePrompt.main.dialog');

        assert.equal(simplePromptResource.id(), 'SimplePrompt.main.dialog');
        const text = await simplePromptResource.readText();
        assert.equal(text[0], '{');
    });

    it('FileResourceProvider load multi-level directory, get by type', async function () {
        let resourceProvider = new FileResourceProvider();
        resourceProvider.registerDirectory('tests/resources');

        let dialogResources = await resourceProvider.getResources('dialog');

        assert.equal(dialogResources.length, 23);
    });
});
