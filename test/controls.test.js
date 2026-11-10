'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(saved = {}) {
  const events = {};
  const storage = new Map(Object.entries(saved));
  const context = { structuredClone, Set, localStorage: { getItem: key => storage.get(key) || null }, document: { activeElement: {}, querySelector: () => null, addEventListener() {} } };
  context.window = context;
  context.addEventListener = (type, callback) => { (events[type] ||= []).push(callback); };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('client/controls.js', 'utf8') + fs.readFileSync('client/inputs.js', 'utf8') + ';window.inputs = new BonkLocalInputs();', context);
  const changes = [];
  context.inputs.onKeyChange((action, down) => changes.push([action, down]));
  return { inputs: context.inputs, context, changes, emit: event => events[event]?.forEach(fn => fn({})) };
}

test('Heavy and Special are independent and include the observed defaults', () => {
  const { inputs } = harness();
  inputs.keyDown('KeyX');
  assert.equal(inputs.action1, true);
  assert.equal(inputs.action2, false);
  inputs.keyDown('KeyZ');
  assert.equal(inputs.action2, true);
  inputs.keyDown('KeyW');
  assert.equal(inputs.up, true);
});
test('releasing one alternative key does not release another held key for the same action', () => {
  const { inputs, changes } = harness();
  inputs.keyDown('KeyX'); inputs.keyDown('Space'); inputs.keyUp('KeyX');
  assert.equal(inputs.action1, true);
  inputs.keyUp('Space');
  assert.deepEqual(changes, [['action1', true], ['action1', false]]);
});
test('blur releases input and typing cannot move a disc', () => {
  const { inputs, context, emit } = harness();
  inputs.keyDown('ArrowRight'); emit('blur');
  assert.equal(inputs.right, false);
  context.document.activeElement = { tagName: 'INPUT' };
  inputs.keyDown('KeyW');
  assert.equal(inputs.up, false);
});
test('saved custom bindings survive reload, leaving Heavy distinct from Special', () => {
  const { inputs } = harness({ bonkControls: JSON.stringify({ action2: ['KeyC', '', ''] }) });
  inputs.keyDown('KeyZ'); assert.equal(inputs.action2, false);
  inputs.keyDown('KeyC'); assert.equal(inputs.action2, true);
  inputs.keyDown('ShiftRight'); assert.equal(inputs.action1, true);
});
test('invalid storage falls back without stopping the game', () => {
  const { inputs } = harness({ bonkControls: '{invalid' });
  inputs.keyDown('KeyA'); assert.equal(inputs.left, true);
});
