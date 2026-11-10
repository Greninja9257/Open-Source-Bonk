'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

// The whole simulation stack, as the browser loads it.
function runtime() {
  const context = vm.createContext({
    roomId: 'test', structuredClone, BonkGraphics: class { render() {} },
    // The vendored solver chats on the console when it bails out of a contact loop.
    console: { log() {}, warn() {}, error() {} }
  });
  context.window = context;
  for (const file of ['resources/accurateclone/client/libraries/Box2D.js',
    'resources/accurateclone/client/math.js', 'client/physics.js', 'client/map-collision.js',
    'client/mode-runtime.js', 'client/match.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  vm.runInContext('activeMode = "b"; matchEnabled = true; matchWinAmount = 999;'
    + ' matchTeams = false; matchQuick = true;', context);
  return vm.runInContext('new BonkPhysics()', context);
}

// Every official map has to survive being played. A map that throws takes the whole game with
// it: the simulation stops, so the round never counts in, the countdown sticks and nothing
// moves. Three joint kinds in the real pools used to do exactly that.
test('every official map can be built and stepped without throwing', () => {
  const { stateFromMap, officialPool } = require(path.join(root, 'src/maps.js'));
  const physics = runtime();
  const broken = [];
  let stepped = 0;
  for (const pool of ['classic', 'arrows', 'grapple']) {
    for (const entry of officialPool(pool)) {
      try {
        let state = stateFromMap(entry.map);
        state.ftu = -1;
        const spawn = state.spawns.find(item => item && item.f) || state.spawns[0];
        assert.ok(spawn, 'the map has somewhere to spawn');
        state.discs = [{ x: spawn.x, y: spawn.y, xv: 0, yv: 0, a: 0, av: 0,
          sx: spawn.x, sy: spawn.y, sxv: 0, syv: 0, team: 1, a1a: 1000, a1: false, ds: 0, da: 270 }];
        state.players = [{ id: 0, team: 1, name: 'P' }];
        state.scores = [0];
        for (let frame = 0; frame < 6; frame++) state = physics.step(1 / 30, state, [{}]);
        assert.ok(Number.isFinite(state.discs[0].x) && Number.isFinite(state.discs[0].y),
          'the disc stays somewhere real');
        for (const body of state.physics.bodies) {
          if (!body) continue;
          assert.ok(Number.isFinite(body.p[0]) && Number.isFinite(body.p[1]),
            `body ${body.n} stays somewhere real`);
        }
        stepped++;
      } catch (error) {
        broken.push(`${pool}/${entry.map.m.n}: ${error.message}`);
      }
    }
  }
  assert.deepEqual(broken, [], 'no official map throws');
  assert.equal(stepped, 289);
});

test('the pools between them use every joint kind the maps can carry', () => {
  const { officialPool } = require(path.join(root, 'src/maps.js'));
  const kinds = new Set();
  for (const pool of ['classic', 'arrows', 'grapple']) {
    for (const entry of officialPool(pool)) {
      for (const joint of entry.map.physics.joints) if (joint) kinds.add(joint.type);
    }
  }
  // Revolute, distance, slider and soft slider all appear, so the step above covers them.
  for (const kind of ['rv', 'd', 'lpj', 'lsj']) {
    assert.ok(kinds.has(kind), `the pools include a ${kind} joint`);
  }
});

test('a revolute joint carries both local anchors, which the solver needs', () => {
  const { officialPool } = require(path.join(root, 'src/maps.js'));
  let checked = 0;
  for (const pool of ['classic', 'arrows', 'grapple']) {
    for (const entry of officialPool(pool)) {
      for (const joint of entry.map.physics.joints) {
        if (!joint || joint.type !== 'rv') continue;
        // `ab` is not stored in the map: it is worked out at import from the one anchor the
        // map does store. Without it the solver reads undefined and the game stops.
        assert.ok(Array.isArray(joint.aa) && joint.aa.length === 2, 'anchor on the first body');
        assert.ok(Array.isArray(joint.ab) && joint.ab.length === 2, 'anchor on the second body');
        assert.ok(joint.ab.every(Number.isFinite), 'and it is a real point');
        assert.equal(typeof joint.ra, 'number', 'with the reference angle');
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked} revolute joints`);
});
