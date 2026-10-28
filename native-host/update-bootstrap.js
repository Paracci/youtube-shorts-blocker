'use strict';
// Stable recovery entry point. This file is excluded from signed updates.
const path = require('node:path');
try {
    require('./app-updater').recover(path.resolve(__dirname, '..'));
    process.env.PARACCI_UPDATE_BOOTSTRAP = '1';
    require('./native-host').main();
} catch (error) {
    // stdout belongs exclusively to Native Messaging frames.
    process.stderr.write('Update recovery failed: ' + error.message + '\n');
    process.exitCode = 1;
}
