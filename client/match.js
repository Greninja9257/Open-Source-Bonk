'use strict';

// Round rules live in the simulation so rollback and late joiners reach the same result.
//
// These are the original's own rules, read out of the live client's simulation rather than
// chosen here. See comparisons/round-evidence.md for where each one is in that code.
//  - A round ends when the number of live discs drops to one (or, with teams, to one team).
//    Reaching zero ends the round as a draw and scores nothing.
//  - The result is then held for 90 frames (the original's `fte` countdown), after which the
//    next round is built with the round counter advanced.
//  - A round opens frozen for 90 frames (`ftu`), during which player input is ignored.
//  - A disc dies when it passes the bottom of the 500px screen, or leaves a 850px radius
//    around the screen centre. That is a screen rule, not a map rule.
//  - Death by touching a fixture whose 'd' flag is set is the documented map mechanic
//    (resources/packets/MAPFORMAT.md).
// The motor speed the original gives the tutorial's sliding platform once the bot is down.
const TUTORIAL_SLIDER_SPEED = 8;
const MATCH_RULES = {
  // The original's f1093.fte and f1093.ftu.
  resultFrames: 90,
  startFreezeFrames: 90,
  // The game screen the death rule is measured against.
  screenWidth: 730,
  screenHeight: 500,
  // How far from the middle of the screen a disc may get before it is gone. This is the
  // original's own figure, measured from the middle of the screen, and together with the
  // floor rule it gives the same shape the real game has: a circle with its bottom cut off
  // flat by the floor.
  deathRadius: 850
};
// The course is wider than the screen, so the out-of-screen rule that ends a round does not
// apply here; the original turns off only its radius half for the tutorial, and a disc that
// drops below the screen is still gone.
//
// The tutorial moves the player's own spawn forward as they get further along: the course
// carries two extra spawns for that, and passing one makes it the place a fall returns you
// to. That is the original's rule, and the spawns are the map's own.
const TUTORIAL_FIRST_CHECKPOINT = 2;
// Discs are circles of one world unit (see the disc shape in physics.js).
const DISC_RADIUS = 1;
// A disc resting against a surface settles a hair clear of exact tangency, so occupancy
// allows that much slack and a disc touching the zone counts as standing in it.
const CAP_SLOP = 0.1;

// True when a disc overlaps the given map fixture. Used for cap-zone occupancy.
function discInsideFixture(state, disc, fixtureIndex) {
  const fixture = state.physics.fixtures[fixtureIndex];
  if (!fixture) return false;
  const shape = state.physics.shapes[fixture.sh];
  const body = state.physics.bodies.find(item => (item.fx || []).includes(fixtureIndex));
  if (!shape || !body) return false;
  // The disc's centre, expressed in the body's frame.
  const dx = disc.x - body.p[0], dy = disc.y - body.p[1];
  const bc = Math.cos(-body.a), bs = Math.sin(-body.a);
  const lx = dx * bc - dy * bs, ly = dx * bs + dy * bc;
  if (shape.type === 'ci') {
    return Math.hypot(lx - shape.c[0], ly - shape.c[1]) <= shape.r + DISC_RADIUS + CAP_SLOP;
  }
  if (shape.type === 'bx') {
    const ox = lx - shape.c[0], oy = ly - shape.c[1];
    const sc = Math.cos(-shape.a), ss = Math.sin(-shape.a);
    return Math.abs(ox * sc - oy * ss) <= shape.w / 2 + DISC_RADIUS + CAP_SLOP
      && Math.abs(ox * ss + oy * sc) <= shape.h / 2 + DISC_RADIUS + CAP_SLOP;
  }
  // Polygons fall back to their bounding circle, which no current map needs.
  const reach = Math.max(...shape.v.map(([x, y]) => Math.hypot(x, y))) * shape.s;
  return Math.hypot(lx, ly) <= reach + DISC_RADIUS + CAP_SLOP;
}
// True when a map body's own middle sits inside the given fixture. Used for the cap zones
// that a physics object triggers rather than a player.
function bodyInsideFixture(state, bodyIndex, fixtureIndex) {
  const body = state.physics.bodies[bodyIndex];
  if (!body) return false;
  return discInsideFixture(state, { x: body.p[0], y: body.p[1] }, fixtureIndex);
}

const modeStepForMatch = BonkPhysics.prototype.step;
// All four are overwritten from the server's game settings before the first simulated frame,
// and carry the original's own field names and defaults.
//  wl: rounds needed to win. The lobby clamps a typed value to 1..9 and falls back to 3;
//      quick play uses 999, which is the original's way of saying "no limit".
//  tea: teams on, which makes a round and a score belong to a team rather than a player.
//  q: quick play, which rotates the map every round and never ends the game.
var matchWinAmount = 3;
var matchTeams = false;
var matchQuick = typeof roomId === 'string' && roomId.startsWith('quick-');
var matchEnabled = true;

function resetDiscs(state) {
  state.discs.forEach(disc => {
    if (!disc) return;
    Object.assign(disc, { x: disc.sx, y: disc.sy, xv: 0, yv: 0, a: 0, av: 0,
      dead: false, killedBy: undefined, heavyStrength: 0,
      // The ability meter, aim and draw all start a round the way the original sets them.
      a1a: activeMode === 'ar' || activeMode === 'ard' ? 500 : 1000, a1: false,
      da: 270, ds: 0 });
  });
  if (state.modeState) {
    state.modeState.projectiles = [];
    state.modeState.grapples = [];
    state.modeState.players.forEach(player => {
      if (!player) return;
      Object.assign(player, { drawing: false });
    });
  }
}

// The pool is the client's own copy of the mode's maps, not part of the synchronised state:
// the original carries its map pool locally too, and keeping it out of the state keeps
// snapshots small. So a state names its map by its index in that pool -- the server puts it
// there as `mapIndex` -- and the map itself is looked up here.
//
// A state may also carry its own pool, which is how the tests drive this.
function mapPoolFor(state) {
  return state.quickMaps?.length ? state.quickMaps
    : (typeof quickMapPool !== 'undefined' ? quickMapPool : []);
}

// Lay a map out in a state, as the map itself defines it.
//
// Everything the simulation moves is in `physics` -- a body's position and velocity, a
// slider's motor direction -- or in the cap zones' progress, so taking those from the map's
// own copy is what puts a map back the way it started.
function applyMap(state, index) {
  const pool = mapPoolFor(state);
  if (!pool.length) return;
  const wrapped = ((index % pool.length) + pool.length) % pool.length;
  const map = pool[wrapped];
  if (!map) return;
  state.mapIndex = wrapped;
  state.physics = structuredClone(map.physics);
  // A pool entry is a map, whose settings and details live in `s` and `m`; a state keeps the
  // same two under `ms` and `mm`.
  state.mm = structuredClone(map.m || map.mm || {});
  state.ms = structuredClone(map.s || map.ms || state.ms || {});
  state.spawns = structuredClone(map.spawns);
  state.capZones = structuredClone(map.capZones || []);
}

// Quick play picks its map from the round counter, not from "the next one after this one":
// the original asks for map `rc + 1` and wraps with `index % length`, so the order is a
// function of the round number alone and a rollback cannot drift it.
function rotateQuickMap(state, round) {
  const pool = mapPoolFor(state);
  if (!pool.length) return;
  const order = state.quickMaps?.length
    ? (state.quickMapOrder?.length === pool.length ? state.quickMapOrder : pool.map((item, index) => index))
    : (typeof quickMapOrder !== 'undefined' && quickMapOrder.length ? quickMapOrder : pool.map((item, index) => index));
  applyMap(state, order[round % order.length]);
  // A different map means different spawns, so the discs take the new map's.
  const spawns = (state.spawns || []).filter(spawn => spawn.f);
  state.discs.forEach((disc, id) => {
    if (!disc || !spawns.length) return;
    const spawn = spawns[id % spawns.length];
    Object.assign(disc, { sx: spawn.x, sy: spawn.y, sxv: spawn.xv, syv: spawn.yv });
  });
}

// A custom game plays one map from the first round to the last, and a new round starts that
// map again rather than carrying on with it: a platform that was shoved stands where it
// began, a swing hangs still, a cap zone is unclaimed. Without this the round before leaves
// the map however it ended, which is the one thing every round after it inherits.
//
// The discs' spawns are left alone on purpose -- it is the same map, so they are already its
// own, and they carry the team flags that assigned them (see pickSpawn).
function resetMap(state) {
  if (Number.isInteger(state.mapIndex)) applyMap(state, state.mapIndex);
}

BonkPhysics.prototype.step = function stepWithMatch(seconds, state, inputs) {
  if (!matchEnabled) {
    // The tutorial is a solo course, so it runs the map's own rules instead of the round loop:
    // the course's black fixtures kill, the player respawns on their spawn, the bot stays dead
    // once it is knocked into a hazard, and the map's cap zone ends the course.
    const next = modeStepForMatch.call(this, seconds, state, inputs);
    // The course has no rounds to count in, so it is never frozen and never shows a
    // countdown. Clearing this here means a course that somehow starts with one set cannot
    // leave the player unable to move.
    next.ftu = -1;
    const playerId = 0;
    const deaths = new Set(next.deathContacts || []);
    const previous = state.tutorialState;
    const tutorial = next.tutorialState = {
      capFrames: previous ? previous.capFrames : 0,
      complete: previous ? previous.complete : false
    };
    const player = next.discs[playerId];
    if (!player) return next;
    const floor = MATCH_RULES.screenHeight / next.physics.ppm;

    // The course's last section is crossed on a sliding platform, and the original only lets
    // it move once the bot is down: until then the same body is a black bar that kills on
    // touch. Killing the bot gives its joint a motor speed and takes the kill off its
    // fixture, which is what turns the hazard into the way across.
    const joint = next.physics.joints[0];
    if (joint && joint.type === 'lpj') {
      const carrier = next.physics.bodies[joint.ba];
      const fixture = carrier && next.physics.fixtures[carrier.fx[0]];
      const botAlive = [1, 2].some(id => next.discs[id] && !next.discs[id].dead);
      if (fixture) fixture.d = botAlive;
      if (!botAlive) joint.pms = TUTORIAL_SLIDER_SPEED;
    }

    // Getting past a checkpoint moves the player's spawn to it, so a fall returns them to
    // where they got to rather than to the start of the course.
    for (let index = TUTORIAL_FIRST_CHECKPOINT; index < (next.spawns || []).length; index++) {
      const checkpoint = next.spawns[index];
      if (checkpoint && player.x > checkpoint.x) {
        player.sx = checkpoint.x;
        player.sy = checkpoint.y;
      }
    }

    for (let id = 0; id < next.discs.length; id++) {
      const disc = next.discs[id];
      if (!disc || disc.dead) continue;
      const lost = deaths.has(id) || Number.isInteger(disc.killedBy) || disc.y > floor;
      if (!lost) continue;
      if (id === playerId) {
        Object.assign(disc, { x: disc.sx, y: disc.sy, xv: 0, yv: 0, a: 0, av: 0,
          killedBy: undefined, heavyStrength: 0 });
        // Put back on a spawn, not moved there, so this step is drawn as it is.
        next.dontInterpolate = true;
      } else disc.dead = true;
    }
    stepCapZones(state, next);
    const course = (next.capZones || []).find(item => item.ty === 1);
    if (course && course.p >= course.l) next.tutorialState.complete = true;
    next.tutorialState.capFrames = course ? course.p : 0;
    next.tutorialComplete = next.tutorialState.complete;
    return next;
  }
  // The original ignores player input while a round is still opening, so the freeze is
  // applied to the input rather than to the physics: the world keeps settling, the players
  // just have no say in it yet.
  const opening = (state.ftu ?? -1) > -1;
  const next = modeStepForMatch.call(this, seconds, state, opening ? frozenInputs(inputs) : inputs);

  // Round bookkeeping carries the original's own fields: ftu counts a round in, fte counts a
  // finished round out, rc is the round number and rl the step number within the game.
  next.ftu = state.ftu ?? -1;
  if (next.ftu > -1) next.ftu--;
  next.rc = state.rc ?? 0;
  next.rl = (state.rl ?? 0) + 1;

  // Deaths. The documented map kills come first, then the original's screen rule.
  const killedByMap = new Set(next.deathContacts || []);
  const ppm = next.physics.ppm;
  const centreX = MATCH_RULES.screenWidth / 2 / ppm;
  const centreY = MATCH_RULES.screenHeight / 2 / ppm;
  for (let id = 0; id < next.discs.length; id++) {
    const disc = next.discs[id];
    if (!disc || disc.dead) continue;
    if (killedByMap.has(id) || Number.isInteger(disc.killedBy)) { disc.dead = true; continue; }
    // Below the floor, or outside the circle around the middle of the screen.
    const belowFloor = disc.y > MATCH_RULES.screenHeight / ppm;
    const outsideCircle = Math.hypot(disc.x - centreX, disc.y - centreY) > MATCH_RULES.deathRadius / ppm;
    if (belowFloor || outsideCircle) disc.dead = true;
  }

  // A cap zone of a type other than 1 is not held by a player: it is triggered by a physics
  // body reaching it, like a ball in a goal, and wins the round for that type's team at
  // once. Types 2 to 5 are red, blue, green and yellow.
  let goalTeam = -1;
  for (const zone of next.capZones || []) {
    if (!zone || zone.ty === 1 || zone.ty === undefined) continue;
    const triggered = next.physics.bodies.some((body, index) => {
      if (!body || body.type === 's') return false;
      return bodyInsideFixture(next, index, zone.i);
    });
    if (triggered) { goalTeam = zone.ty; break; }
  }

  // Who is left, before and after this step. A disc that was already gone is not a contender,
  // which is what makes a one-player room end its round only when that player dies.
  const liveBefore = countLive(state, matchTeams);
  const liveNow = countLive(next, matchTeams);
  let roundOver = false, hasWinner = false, winner = -1;
  if (goalTeam !== -1) {
    roundOver = true;
    hasWinner = true;
    winner = goalTeam;
  } else if (liveNow.count === 1 && liveBefore.count > 1) {
    roundOver = true; hasWinner = true; winner = liveNow.last;
  } else if (liveNow.count === 0 && liveBefore.count >= 1) {
    roundOver = true;
  }

  // Scores are carried from the previous step. A player who has left the room loses theirs,
  // which the original marks by nulling the slot rather than removing it.
  next.scores = (state.scores || []).slice();
  if (!matchTeams) {
    for (let id = 0; id < next.scores.length; id++) {
      if (next.scores[id] >= 0 && !next.players[id]) next.scores[id] = null;
    }
  }
  next.lscr = state.lscr ?? -1;
  if ((state.fte ?? -1) >= 0) {
    next.fte = state.fte - 1;
  } else {
    next.fte = -1;
    if (roundOver) {
      next.fte = MATCH_RULES.resultFrames;
      if (hasWinner) {
        next.scores[winner] = (next.scores[winner] || 0) + 1;
        next.lscr = winner;
      } else next.lscr = -1;
    }
  }

  stepCapZones(state, next);

  // The frame the held result runs out is the frame the game either ends or starts a round.
  if (state.fte === 0) {
    if (gameIsComplete(state)) {
      next.gameComplete = true;
      next.fte = -1;
      return next;
    }
    next.rc = state.rc + 1;
    next.rl = 0;
    // Everything has just been put back on its spawn, so this step is drawn as it is rather
    // than slid into from where the last round ended.
    next.dontInterpolate = true;
    next.ftu = MATCH_RULES.startFreezeFrames;
    next.fte = -1;
    // Quick play's next round is the next map in the order; a custom game's is the same map
    // again, from the top.
    if (matchQuick) rotateQuickMap(next, next.rc);
    else resetMap(next);
    resetDiscs(next);
  }
  return next;
};

// Capture zones.
//
// A zone belongs to one player at a time and remembers how far they got. Leaving it does not
// undo that: the progress and the colour stay, and standing in it again carries on from
// there. Someone else standing in it works that progress back down instead, at the same rate
// however many of them there are, and once it reaches nothing the zone is free for whoever
// is left standing in it alone. A zone with a crowd in it does not move at all, whether that
// crowd includes the player who owns it or not.
function stepCapZones(state, next) {
  const zones = next.capZones || [];
  // The original keeps a zone's progress and its owner on the zone itself, as `p` and `o`.
  for (const zone of zones) {
    if (typeof zone.p !== 'number') zone.p = 0;
    if (zone.o === undefined) zone.o = null;
  }

  for (let index = 0; index < zones.length; index++) {
    const zone = zones[index];
    const live = { get owner() { return zone.o; }, set owner(v) { zone.o = v; },
      get progress() { return zone.p; }, set progress(v) { zone.p = v; } };
    const occupants = [];
    for (let id = 0; id < next.discs.length; id++) {
      const disc = next.discs[id];
      if (!disc || disc.dead) continue;
      if (discInsideFixture(next, disc, zone.i)) occupants.push(id);
    }
    if (!occupants.length) continue;

    if (live.owner === null) {
      // Nobody has a claim: one player alone can start one, a crowd cannot.
      if (occupants.length === 1) {
        live.owner = occupants[0];
        live.progress = Math.min(zone.l, live.progress + 1);
      }
      continue;
    }

    const ownerInside = occupants.includes(live.owner);
    const others = occupants.length - (ownerInside ? 1 : 0);
    if (ownerInside && others === 0) {
      live.progress = Math.min(zone.l, live.progress + 1);
    } else if (!ownerInside && others > 0) {
      // Contested from outside: one step down a frame, no faster for a crowd.
      live.progress -= 1;
      if (live.progress <= 0) {
        live.progress = 0;
        live.owner = null;
        // Whoever is left alone in it takes it from here.
        if (occupants.length === 1) live.owner = occupants[0];
      }
    }
    // The owner sharing the zone with someone else holds it exactly where it is.
  }
}

// The count of live discs, and with teams the count of live teams. `last` is the winner the
// original takes when exactly one is left: the surviving disc, or that disc's team.
function countLive(state, teams) {
  let count = 0, last = -1;
  const seen = [];
  for (let id = 0; id < state.discs.length; id++) {
    const disc = state.discs[id];
    if (!disc || disc.dead) continue;
    if (!teams) { count++; last = id; continue; }
    if (!seen[disc.team]) { seen[disc.team] = true; count++; last = disc.team; }
  }
  return { count, last };
}

// Input while a round is counting in. Everything is released so nobody can move or act, with
// one exception: the heavy key still registers. The world is not being stepped, so it changes
// nothing — it just lets a player hold heavy as the round opens and see it on their disc,
// instead of having to find the key after the whistle.
function frozenInputs(inputs) {
  if (!inputs) return inputs;
  return inputs.map(input => {
    if (!input) return input;
    const released = {};
    for (const key of Object.keys(input)) released[key] = false;
    released.action1 = input.action1 === true;
    return released;
  });
}

// Decided on the step whose held result has just run out, from that step's scores: the game
// is over once a score reaches the rounds-to-win. There are no tie-break rounds — a round
// nobody survives is simply a draw, scores nothing, and the game plays on. Quick play sets
// the target to 999 and so never gets here.
function gameIsComplete(state) {
  let top = 0;
  const scores = state.scores || [];
  for (let id = 0; id < scores.length; id++) {
    if (scores[id] > top) top = scores[id];
  }
  return top >= matchWinAmount;
}
