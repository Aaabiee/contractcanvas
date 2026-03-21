/* eslint-disable @typescript-eslint/no-require-imports */
require('zone.js');
require('@angular/compiler');

const { getTestBed } = require('@angular/core/testing');
const { BrowserDynamicTestingModule, platformBrowserDynamicTesting } =
  require('@angular/platform-browser-dynamic/testing');

const testBed = getTestBed();
let envInitialized = false;

// Auto-initialize the test environment and reset state on each
// configureTestingModule call. We can't use destroyAfterEach because
// afterEach isn't available during setupFiles in Jest 30.
const origConfigure = testBed.configureTestingModule.bind(testBed);
testBed.configureTestingModule = function (...args: any[]) {
  if (!envInitialized) {
    testBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    envInitialized = true;
  }
  testBed.resetTestingModule();
  return origConfigure(...args);
};
