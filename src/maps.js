'use strict';

// The official map pools, in the documented Bonk map schema (resources/packets/MAPFORMAT.md):
// shapes -> fixtures -> bodies, plus bro display order, spawns and capZones.
//
// src/official-maps.json holds the real pick pools that the live client carries for quick
// play: the community picks it uses for Classic, the arrow picks for Arrows and the grapple
// picks for Grapple. They were decoded with the client's own map parser and converted to the
// units the simulation works in; scripts/import-official-maps.mjs does both, and
// comparisons/maps-evidence.md records where each step comes from.

const codec = require('./map-codec.js');
const tutorialMap = require('./tutorial-map.js');
const officialMaps = require('./official-maps.json');

// Which pool a game mode plays. The names are the original's own pool names.
const MODE_POOLS = { b: 'classic', bs: 'classic', v: 'classic', ar: 'arrows', ard: 'arrows', sp: 'grapple' };

// The original shuffles one master order of 160 map slots per session, then gives each pool
// its own copy with the slots past that pool's end dropped. Every room in the session then
// walks the same order, so a map is a function of the round number.
function masterMapOrder() {
  const order = [];
  for (let i = 0; i < 160; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const pick = Math.floor(Math.random() * (i + 1));
    [order[i], order[pick]] = [order[pick], order[i]];
  }
  return order;
}

function poolOrder(master, poolName) {
  const length = (officialMaps[poolName] || []).length;
  return master.filter(index => index < length);
}

function poolFor(mode) {
  return MODE_POOLS[mode] || 'classic';
}

function officialPool(poolName) {
  return officialMaps[poolName] || [];
}

// One map from a pool, as a fresh copy the caller can mutate. The index wraps, which is how
// the original keeps walking its order past the end of the list.
function officialMap(poolName, index = 0) {
  const list = officialPool(poolName);
  if (!list.length) return null;
  const entry = list[((index % list.length) + list.length) % list.length];
  return structuredClone(entry.map);
}

// The official tutorial course, read out of the running game and stored in src/tutorial-map.js.
// It is returned as a fresh deep copy so callers can mutate their own instance.
function practiceCourse() {
  return structuredClone(tutorialMap);
}

// The simulation's state object, built from a map the documented way.
// A distance joint holds its two anchors a fixed distance apart, and that distance is not
// stored in the map: the original works it out when it builds the state. Doing it here, once,
// matters — a joint left without one makes the solver measure the gap fresh every frame, so
// the spring has nothing to pull back towards and the body it holds drifts instead of
// swinging.
function restLength(joint, bodies) {
  const bodyA = joint.ba === -1 ? null : bodies[joint.ba];
  const bodyB = joint.bb === -1 ? null : bodies[joint.bb];
  const turn = (x, y, angle) => {
    const cos = Math.round(Math.cos(angle) * 1e7) / 1e7;
    const sin = Math.round(Math.sin(angle) * 1e7) / 1e7;
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const [ax, ay] = turn(joint.aa[0], joint.aa[1], bodyA ? bodyA.a : 0);
  const [bx, by] = turn(joint.ab[0], joint.ab[1], bodyB ? bodyB.a : 0);
  const dx = ((bodyA ? bodyA.p[0] : 0) + ax) - ((bodyB ? bodyB.p[0] : 0) + bx);
  const dy = ((bodyA ? bodyA.p[1] : 0) + ay) - ((bodyB ? bodyB.p[1] : 0) + by);
  return Math.hypot(dx, dy) || 0.01;
}

function stateFromMap(map) {
  return {
    ms: { ...map.s },
    mm: { ...map.m },
    shk: { x: 0, y: 0 },
    discs: [],
    players: [],
    scores: [],
    projectiles: [],
    capZones: map.capZones.map(zone => ({ ...zone })),
    spawns: map.spawns.map(spawn => ({ ...spawn })),
    seed: 87,
    // A game opens with the original's 90-frame round-in freeze, on round 0, step 0.
    ftu: 90,
    rc: 0,
    rl: 0,
    sts: null,
    lscr: -1,
    fte: -1,
    discDeaths: [],
    physics: {
      shapes: map.physics.shapes.map(shape => ({ ...shape })),
      fixtures: map.physics.fixtures.map(fixture => ({ ...fixture })),
      bodies: map.physics.bodies.map(body => ({ ...body, cf: { ...body.cf }, fx: [...body.fx] })),
      joints: map.physics.joints.map(joint => {
        const copy = { ...joint, d: joint.d ? { ...joint.d } : joint.d };
        if (copy.aa) copy.aa = [...copy.aa];
        if (copy.ab) copy.ab = [...copy.ab];
        if (copy.type === 'd' && typeof copy.len !== 'number') {
          copy.len = restLength(copy, map.physics.bodies);
        }
        return copy;
      }),
      bro: [...map.physics.bro],
      ppm: map.physics.ppm
    }
  };
}

// Spawn choice follows the documented spawn fields: team flag first, then priority.
function pickSpawn(spawns, { team = 0, index = 0 } = {}) {
  const flag = ['f', 'r', 'b', 'gr', 'ye'][team] || 'f';
  const eligible = spawns.filter(spawn => spawn[flag]);
  const pool = eligible.length ? eligible : spawns;
  if (!pool.length) return { x: 0, y: 0, xv: 0, yv: 0 };
  const ranked = [...pool].sort((a, b) => b.priority - a.priority);
  const best = ranked.filter(spawn => spawn.priority === ranked[0].priority);
  return best[index % best.length];
}

module.exports = { MODE_POOLS, masterMapOrder, poolOrder, poolFor, officialPool, officialMap,
  practiceCourse, stateFromMap, pickSpawn };
