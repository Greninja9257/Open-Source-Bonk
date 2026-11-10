'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercises the real Box2D solver through the same stack the browser loads.
function runtime({ mode = 'b', rounds = 3, teams = false, quick = false } = {}) {
  const context = vm.createContext({ roomId: 'test', structuredClone, BonkGraphics: class { render() {} } });
  context.window = context;
  for (const file of ['resources/accurateclone/client/libraries/Box2D.js', 'resources/accurateclone/client/math.js',
    'client/physics.js', 'client/map-collision.js', 'client/mode-runtime.js', 'client/match.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(`activeMode = ${JSON.stringify(mode)}; matchWinAmount = ${rounds}; matchEnabled = true;`
    + ` matchTeams = ${teams}; matchQuick = ${quick};`, context);
  return { physics: vm.runInContext('new BonkPhysics()', context), context };
}

const disc = (x, y) => ({ x, y, xv: 0, yv: 0, a: 0, av: 0, sx: x, sy: y });
// ppm 12 puts the screen at 60.8 x 41.7 world units, so the original's death rule kills
// below y 41.7 or outside a 70.8 radius of the screen centre (30.4, 20.8).
const DEAD_BELOW = 500 / 12;
function arena(count = 2, { ftu = -1, teams = false } = {}) {
  const state = { discs: [], players: [], scores: [], fte: -1, ftu, rc: 0, rl: 0, lscr: -1,
    physics: { shapes: [], fixtures: [], bodies: [], joints: [], ppm: 12 } };
  state.physics.shapes.push({ type: 'bx', c: [0, 0], a: 0, w: 20, h: 2 });
  state.physics.fixtures.push({ sh: 0, fr: 0.5, re: 0.2, de: 0.3 });
  state.physics.bodies.push({ p: [0, 0], a: 0, type: 's', lv: [0, 0], av: 0, ad: 0, ld: 0, fx: [0], fric: 0.5, re: 0.2, de: 0.3 });
  for (let id = 0; id < count; id++) {
    const team = teams ? 2 + (id % 2) : 1;
    state.discs.push({ ...disc(id === 0 ? -2 : 2, -2), team });
    state.players.push({ id, team, name: `P${id}`, color: '#5555ff' });
    if (teams) state.scores[team] = 0; else state.scores.push(0);
  }
  return state;
}
const advance = (physics, state, frames, inputs = [{}, {}]) => {
  let next = state;
  for (let i = 0; i < frames; i++) next = physics.step(1 / 30, next, inputs);
  return next;
};

test('a round opens frozen, and input only takes effect once the freeze runs out', () => {
  const { physics } = runtime();
  // The original opens a round with ftu at 90 and ignores player input until it reaches -1.
  let next = physics.step(1 / 30, arena(2, { ftu: 90 }), [{ right: true }, {}]);
  assert.equal(next.ftu, 89);
  next = advance(physics, next, 60, [{ right: true }, {}]);
  assert.equal(next.ftu, 29);
  assert.ok(Math.abs(next.discs[0].xv) < 0.01, 'held input does nothing while the round opens');
  next = advance(physics, next, 31, [{ right: true }, {}]);
  assert.equal(next.ftu, -1, 'the freeze ends at -1');
  next = advance(physics, next, 20, [{ right: true }, {}]);
  assert.ok(next.discs[0].xv > 0.5, 'input works once the round is live');
});

test('falling past the bottom of the screen is a knockout, and the last disc takes the round', () => {
  const { physics } = runtime();
  const inputs = [{}, {}, {}];
  let next = advance(physics, physics.step(1 / 30, arena(3), inputs), 5, inputs);
  assert.equal(next.fte, -1);

  // One knockout with three discs leaves the round running.
  next.discs[2].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, inputs);
  assert.equal(next.discs[2].dead, true);
  assert.deepEqual(next.scores, [0, 0, 0]);
  assert.equal(next.fte, -1, 'the round is still live');

  // The second decides it: the survivor scores and the result is held for 90 frames.
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, inputs);
  assert.deepEqual(next.scores, [1, 0, 0]);
  assert.equal(next.lscr, 0, 'the survivor is the round winner');
  assert.equal(next.fte, 90);
  assert.equal(next.rc, 0, 'the round counter only moves when the next round starts');

  // 90 frames later the next round is built, frozen, with everyone back on their spawn.
  next = advance(physics, next, 91, inputs);
  assert.equal(next.fte, -1);
  assert.equal(next.rc, 1);
  assert.equal(next.ftu, 90, 'the next round opens frozen');
  assert.equal(next.discs[1].dead, false, 'knocked out discs return for the next round');
  assert.equal(next.discs[2].x, next.discs[2].sx);
  assert.deepEqual(next.scores, [1, 0, 0], 'scores carry into the next round');
});

test('a disc that leaves the screen sideways is also a knockout', () => {
  const { physics } = runtime();
  let next = advance(physics, physics.step(1 / 30, arena(3), [{}, {}, {}]), 5);
  // Outside the original's 850px radius of the screen centre, without being below it.
  next.discs[2].x = 30.4 + 850 / 12 + 1;
  next.discs[2].y = 20.8;
  next = physics.step(1 / 30, next, [{}, {}, {}]);
  assert.equal(next.discs[2].dead, true);
});

test('a round that leaves nobody alive is a draw and scores nothing', () => {
  const { physics } = runtime();
  let next = advance(physics, physics.step(1 / 30, arena(2), [{}, {}]), 5);
  next.discs[0].y = DEAD_BELOW + 1;
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, [{}, {}]);
  assert.equal(next.fte, 90, 'a draw still holds the result');
  assert.equal(next.lscr, -1, 'nobody is named');
  assert.deepEqual(next.scores, [0, 0]);
});

test('reaching the round target completes the game instead of starting a round', () => {
  const { physics } = runtime({ rounds: 1 });
  let next = advance(physics, physics.step(1 / 30, arena(2), [{}, {}]), 5);
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, [{}, {}]);
  assert.deepEqual(next.scores, [1, 0]);
  assert.equal(next.fte, 90);
  // The game ends on the frame the held result runs out, and no new round is built.
  next = advance(physics, next, 91, [{}, {}]);
  assert.equal(next.gameComplete, true);
  assert.equal(next.rc, 0, 'a completed game does not advance the round counter');
  assert.deepEqual(next.scores, [1, 0]);
});

test('quick play never completes, and takes its next map from the round counter', () => {
  const { physics } = runtime({ rounds: 999, quick: true });
  const first = arena();
  const second = arena();
  second.physics.bodies[0].p[0] = 10;
  first.quickMaps = [structuredClone(first), { physics: second.physics, mm: { n: 'Next map' },
    spawns: [{ x: 3, y: -2, xv: 0, yv: 0, f: true }, { x: 7, y: -2, xv: 0, yv: 0, f: true }], capZones: [] }];
  first.mapIndex = 0;
  let next = advance(physics, physics.step(1 / 30, first, [{}, {}]), 5);
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, [{}, {}]);
  next = advance(physics, next, 91, [{}, {}]);
  assert.equal(next.gameComplete, undefined, 'a quick match has no win amount to reach');
  assert.equal(next.rc, 1);
  assert.equal(next.mapIndex, 1, 'round 1 takes map 1');
  assert.equal(next.mm.n, 'Next map');
  assert.equal(next.physics.bodies[0].p[0], 10);
  assert.equal(next.discs[0].x, 3);
  assert.equal(next.discs[1].x, 7);
  assert.deepEqual(next.scores, [1, 0], 'quick play keeps scoring across maps');
});

test('a custom game plays one map, and starts each round with it back as it began', () => {
  // Not quick play: a custom room keeps the map its lobby chose for the whole game.
  const { physics } = runtime();
  const first = arena(2);
  first.mm = { n: 'One map' };
  // The client's own copy of the pool, which is where the map a state names is read from.
  first.quickMaps = [{
    physics: structuredClone(first.physics),
    m: { n: 'One map' },
    s: {},
    spawns: [{ x: -2, y: -2, xv: 0, yv: 0, f: true }, { x: 2, y: -2, xv: 0, yv: 0, f: true }],
    capZones: []
  }];
  first.mapIndex = 0;
  let next = advance(physics, physics.step(1 / 30, first, [{}, {}]), 5);
  // The round leaves the map somewhere other than where it started: a platform shoved
  // along, and a cap zone part way to being taken.
  next.physics.bodies[0].p = [9, 3];
  next.capZones = [{ i: 0, p: 70, o: 0 }];
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, [{}, {}]);
  assert.equal(next.fte, 90, 'the round is over and its result held');
  next = advance(physics, next, 91, [{}, {}]);
  assert.equal(next.rc, 1, 'the next round has started');
  assert.equal(next.mapIndex, 0, 'on the same map, not the next one in the pool');
  assert.equal(next.mm.n, 'One map');
  assert.deepEqual(next.physics.bodies[0].p, [0, 0], 'with the platform back on its mark');
  assert.deepEqual(next.capZones, [], 'and nothing left of the last round in the zones');
  assert.equal(next.discs[0].y, next.discs[0].sy, 'and the discs on their spawns');
  assert.deepEqual(next.scores, [1, 0], 'scores carry across rounds');
});

test('a solo disc dying ends the round without scoring, and the next round returns it', () => {
  const { physics } = runtime();
  let next = advance(physics, physics.step(1 / 30, arena(1), [{}]), 5, [{}]);
  next.discs[0].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, [{}]);
  assert.deepEqual(next.scores, [0]);
  assert.equal(next.lscr, -1);
  assert.equal(next.fte, 90);
  next = advance(physics, next, 91, [{}]);
  assert.equal(next.gameComplete, undefined);
  assert.equal(next.discs[0].y, next.discs[0].sy);
});

test('with teams, a round and a score belong to the team', () => {
  const { physics } = runtime({ teams: true });
  const inputs = [{}, {}, {}, {}];
  // Four discs, teams 2 and 3 alternating, so ids 0 and 2 are red and 1 and 3 are blue.
  let next = advance(physics, physics.step(1 / 30, arena(4, { teams: true }), inputs), 5, inputs);
  next.discs[1].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, inputs);
  assert.equal(next.fte, -1, 'one blue disc down still leaves blue in the round');
  next.discs[3].y = DEAD_BELOW + 1;
  next = physics.step(1 / 30, next, inputs);
  assert.equal(next.fte, 90, 'the round ends when a team runs out');
  assert.equal(next.lscr, 2, 'red takes the round');
  assert.equal(next.scores[2], 1);
  assert.equal(next.scores[3], 0);
});

test('a player who leaves the room loses their score', () => {
  const { physics } = runtime();
  let next = advance(physics, physics.step(1 / 30, arena(3), [{}, {}, {}]), 5);
  next.scores = [2, 1, 0];
  // The original marks a departed player by nulling their slot rather than removing it.
  next.players[1] = undefined;
  next = physics.step(1 / 30, next, [{}, {}, {}]);
  assert.equal(next.scores[1], null);
  assert.deepEqual([next.scores[0], next.scores[2]], [2, 0], 'everyone else keeps theirs');
});

test('Death Arrows kills on contact; Classic arrows do not', () => {
  const lethal = mode => {
    const { physics } = runtime({ mode });
    let next = advance(physics, physics.step(1 / 30, arena(), [{}, {}]), 95);
    const target = next.discs[1];
    next.modeState.projectiles.push({ owner: 0, x: target.x - 2, y: target.y,
      xv: 40, yv: 0, a: 0, av: 0, age: 0.3 });
    next = advance(physics, next, 4);
    return next;
  };
  const deadly = lethal('ard');
  assert.deepEqual(deadly.scores, [1, 0], 'the hit is a knockout, so the shooter takes the round');
  const classic = lethal('ar');
  assert.deepEqual(classic.scores, [0, 0]);
  assert.ok(!classic.discs[1].dead, 'a Classic arrow only pushes the disc');
});

test('the round loop can be switched off for the solo tutorial course', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  const next = physics.step(1 / 30, arena(1), [{ right: true }]);
  assert.equal(next.matchState, undefined, 'no rounds, scores or countdown in the tutorial');
  assert.ok(next.discs[0].xv > 0, 'the course is immediately playable');
});

test('the round-in countdown actually counts down, and only then does play start', () => {
  const { physics } = runtime();
  let next = arena(2, { ftu: 90 });
  const startX = next.discs[0].x;
  const seen = [];
  for (let frame = 0; frame < 95; frame++) {
    next = physics.step(1 / 30, next, [{ right: true }, {}]);
    if ([0, 44, 89, 90, 94].includes(frame)) seen.push(next.ftu);
  }
  // 90 down to -1, one a frame, and it stops at -1 rather than running on.
  assert.deepEqual(seen, [89, 45, 0, -1, -1]);
  assert.ok(next.discs[0].x > startX, 'the player has control once the countdown is done');
});

test('the tutorial course is never frozen and never counts a round in', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  // Even handed a state that arrives counting down, the course must run: it has no rounds, so
  // a countdown here would leave the player unable to move with nothing explaining why.
  let next = arena(1, { ftu: 90 });
  const startX = next.discs[0].x;
  next = physics.step(1 / 30, next, [{ right: true }]);
  assert.equal(next.ftu, -1, 'the course clears any countdown');
  next = advance(physics, next, 25, [{ right: true }]);
  assert.equal(next.ftu, -1);
  assert.ok(next.discs[0].x > startX, 'and the player can move from the start');
});

test('a tutorial death returns the player to their own spawn and leaves the bot down', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  let next = arena(2);
  Object.assign(next.discs[0], { sx: 4, sy: 30 });
  Object.assign(next.discs[1], { sx: 40, sy: 30 });
  // Below the bottom of the screen, which at ppm 12 is 41.7.
  next.discs[0].y = 80;
  next.discs[1].y = 80;
  next = physics.step(1 / 30, next, [{}, {}]);
  assert.equal(next.discs[0].x, 4, 'the player returns to their own spawn');
  assert.equal(next.discs[0].y, 30);
  assert.equal(next.discs[0].xv, 0);
  assert.ok(!next.discs[0].dead, 'the player is never knocked out of the course');
  assert.ok(next.discs[1].dead, 'the bot stays down once it falls');
});

test('passing a checkpoint moves the player\'s spawn to it', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  let next = arena(1);
  next.physics.shapes[0].w = 400;
  // The course's checkpoints are spawns past the first two, which are the player's start and
  // the bot's. Getting past one makes it the place a fall returns the player to.
  next.spawns = [
    { x: -2, y: -2, xv: 0, yv: 0, f: true, priority: 9, n: 'player spawn' },
    { x: 40, y: -2, xv: 0, yv: 0, r: true, priority: 4, n: 'dummyspawn2' },
    { x: 20, y: 5, xv: 0, yv: 0, f: true, priority: 3, n: 'player spawn 2' },
    { x: 60, y: 8, xv: 0, yv: 0, f: true, priority: 3, n: 'player spawn 3' }
  ];
  Object.assign(next.discs[0], { x: 0, y: -2, sx: -2, sy: -2 });

  // Short of the first checkpoint, a fall still returns them to the start.
  next = advance(physics, next, 3, [{}]);
  assert.equal(next.discs[0].sx, -2, 'the spawn has not moved yet');

  // Past the first checkpoint, that becomes their spawn.
  next.discs[0].x = 25;
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.discs[0].sx, 20);
  assert.equal(next.discs[0].sy, 5);

  // Past the second, it moves on again, and a fall returns them there.
  next.discs[0].x = 70;
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.discs[0].sx, 60);
  assert.equal(next.discs[0].sy, 8);
  next.discs[0].y = 90;
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.discs[0].x, 60, 'a fall returns them to the checkpoint they reached');
  assert.equal(next.discs[0].y, 8);

  // A checkpoint is a point, not wherever they happened to be standing.
  next.discs[0].x = 120;
  next.discs[0].y = 90;
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.discs[0].x, 60, 'the last checkpoint always returns the same point');
});

test('the course\'s sliding bar only moves, and stops killing, once the bot is down', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  let next = arena(2);
  // A body on a limited prismatic joint, with its first fixture marked as a kill, which is
  // how the course carries its sliding bar.
  const shape = next.physics.shapes.push({ type: 'bx', c: [0, -10], a: 0, w: 60, h: 1 }) - 1;
  const fixture = next.physics.fixtures.push({ sh: shape, fr: 0.3, re: 0.8, de: 0.3, d: true }) - 1;
  const body = next.physics.bodies.push({ p: [100, 30], a: 0, type: 'd', lv: [0, 0], av: 0,
    ad: 0, ld: 0, fx: [fixture], fric: 0.5, re: 0.8, de: 0.3,
    cf: { x: 0, y: 0, w: true, ct: 0 } }) - 1;
  next.physics.joints = [{ type: 'lpj', ba: body, bb: -1, pax: 100, pay: 30, pa: 0,
    pf: 10000, pl: 0, pu: 0, plen: 90, pms: 0, d: { cc: false, bf: 0, dl: true } }];

  // While the bot is alive the bar is a kill and does not move.
  next = advance(physics, next, 10, [{}, {}]);
  assert.equal(next.physics.fixtures[fixture].d, true, 'the bar kills on touch');
  assert.equal(next.physics.joints[0].pms, 0, 'and it stays put');
  const stillX = next.physics.bodies[body].p[0];

  // With the bot down it stops killing and starts sliding.
  next.discs[1].dead = true;
  next = physics.step(1 / 30, next, [{}, {}]);
  assert.equal(next.physics.fixtures[fixture].d, false, 'the bar is safe to stand on');
  assert.equal(next.physics.joints[0].pms !== 0, true, 'and its motor is running');
  next = advance(physics, next, 60, [{}, {}]);
  assert.ok(Math.abs(next.physics.bodies[body].p[0] - stillX) > 1, 'the bar has moved');
});

test('the tutorial cap zone has to be held for its documented frame count', () => {
  const { physics, context } = runtime();
  vm.runInContext('matchEnabled = false', context);
  let next = arena(1);
  // The floor doubles as the control point, so resting on it starts the capture.
  next.capZones = [{ n: 'Cap Zone', ty: 1, l: 4, i: 0 }];
  next.discs[0].y = -40;
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.tutorialState.capFrames, 0, 'standing well clear captures nothing');
  assert.ok(!next.tutorialComplete);
  next.discs[0].y = -2;
  for (let frame = 0; frame < 3; frame++) next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.tutorialState.capFrames, 3);
  assert.ok(!next.tutorialComplete, 'a short visit does not capture the point');
  next = physics.step(1 / 30, next, [{}]);
  assert.ok(next.tutorialComplete, "holding it for the zone's frame count finishes the course");
});
