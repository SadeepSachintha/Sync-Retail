/**
 * Sync Retail POS - Sound Synthesizer Customizer DOM Integration Test
 * Audits public index.html DOM structure for custom sliders.
 */

const fs = require('fs');
const path = require('path');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'local-pos', 'public', 'index.html');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

async function log(msg, color = RESET) {
  console.log(`${color}${msg}${RESET}`);
}

async function assert(condition, message) {
  if (condition) {
    log(`[PASS] ${message}`, GREEN);
  } else {
    log(`[FAIL] ${message}`, RED);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest() {
  log('==================================================', BLUE);
  log('   STARTING AUDIO SYNTH DOM INTEGRATION TEST      ', BLUE);
  log('==================================================', BLUE);

  try {
    log(`Reading: ${INDEX_HTML_PATH}`, BLUE);
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

    // 1. Assert Waveform Shape dropdown exists
    await assert(html.includes('id="sound-osc-select"'), 'WAVEFORM SHAPE select element exists in DOM.');

    // 2. Assert Pitch range slider exists
    await assert(html.includes('id="synth-pitch"'), 'BEEP PITCH range slider exists in DOM.');
    await assert(html.includes('id="synth-pitch-val"'), 'BEEP PITCH label display node exists in DOM.');

    // 3. Assert Volume range slider exists
    await assert(html.includes('id="synth-volume"'), 'BEEP VOLUME range slider exists in DOM.');
    await assert(html.includes('id="synth-volume-val"'), 'BEEP VOLUME label display node exists in DOM.');

    // 4. Assert Duration range slider exists
    await assert(html.includes('id="synth-duration"'), 'BEEP DURATION range slider exists in DOM.');
    await assert(html.includes('id="synth-duration-val"'), 'BEEP DURATION label display node exists in DOM.');

    // 5. Assert Test Button exists
    await assert(html.includes('id="synth-test-btn"'), 'Test Sound Cue trigger button exists in DOM.');

    log('\n==================================================', GREEN);
    log('   AUDIO SYNTH DOM AUDIT SUCCESSFUL!              ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   AUDIO SYNTH TESTS FAILED: ${error.message}    `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
