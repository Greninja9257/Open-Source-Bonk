'use strict';

// Adapted from resources/accurateclone/client/bonk.js. Differences, all deliberate:
//  - a late input or roster change overwrites the frames it invalidated, so rollback corrects
//    mispredictions instead of keeping the first guess;
//  - absolute input state is snapshotted per frame, because the wire carries only key changes;
//  - roster changes arrive as frame-stamped events, so joins and leaves land on one frame for everyone;
//  - the authority uploads periodic state snapshots, so a late joiner replays seconds, not a whole match;
//  - state history is pruned, so a long session does not grow without bound.

const FRAME_MS = 1000 / 30;
const HISTORY_FRAMES = 150;
const SNAPSHOT_INTERVAL = 90;
// Snapshots lag the simulation so they describe a frame rollback has stopped touching.
const CONFIRM_LAG = 20;
const INPUT_KEYS = ['up', 'down', 'left', 'right', 'action1', 'action2'];

// Background sampled from the live game frame: rgb(48, 67, 86).
const render = new PIXI.Application({ width: 730, height: 500, antialias: true, autoDensity: false,
  resolution: window.devicePixelRatio, powerPreference: 'high-performance',
  backgroundColor: 0x304356 });
const physics = new BonkPhysics();
const localInputs = new BonkLocalInputs();
const networking = new BonkNetworking('');
// The chrome (game-ui.js) needs to send the odd message of its own, such as the host
// ending a game. BonkNetworking keeps the raw socket on .socket.
window.bonkNetworking = networking;
const graphics = new BonkGraphics(render);
document.body.appendChild(render.view);

const gameStateList = [];
const eventList = [];
const inputSnapshots = [];
const currentInputs = [];
let inputList = [];
let currentFrame = 0;
let baseFrame = 0;
let oldestFrame = 0;
let msPassed = 0;
let timeStampOLD = Date.now();
let recalculationFrame = Infinity;
let snapshotAuthority = null;
let lastSnapshotFrame = 0;
let loopStarted = false;
window.initialTimeStamp = Date.now();

const blankInput = () => Object.fromEntries(INPUT_KEYS.map(key => [key, false]));
const cloneInputs = () => currentInputs.map(input => ({ ...input }));

function ensureInputSlot(id) {
  while (currentInputs.length <= id) currentInputs.push(blankInput());
}

function restoreInputs(snapshot) {
  currentInputs.length = 0;
  for (const input of snapshot) currentInputs.push({ ...blankInput(), ...input });
}

function invalidateFrom(frame) {
  if (frame < recalculationFrame) recalculationFrame = frame;
}

// Roster changes are part of the timeline, so every client applies them on the same frame.
function applyEvents(frame) {
  const state = gameStateList[frame];
  for (const event of eventList[frame] || []) {
    if (event.type === 'join') {
      ensureInputSlot(event.id);
      currentInputs[event.id] = blankInput();
      state.discs[event.id] = structuredClone(event.disc);
      // A join event can be based on the room's initial map even after the
      // synchronized Quick Play simulation has rotated to a later map.
      if (state.quickMaps?.length) {
        const eligible = state.spawns.filter(spawn => spawn.f);
        const priority = Math.max(...eligible.map(spawn => spawn.priority));
        const pool = eligible.filter(spawn => spawn.priority === priority);
        const spawn = pool[event.id % pool.length];
        if (spawn) Object.assign(state.discs[event.id], {
          x: spawn.x, y: spawn.y, xv: spawn.xv, yv: spawn.yv,
          sx: spawn.x, sy: spawn.y, sxv: spawn.xv, syv: spawn.yv
        });
      }
      state.players[event.id] = structuredClone(event.player);
      state.scores[event.id] ||= 0;
    } else if (event.type === 'leave') {
      delete state.discs[event.id];
      delete state.players[event.id];
      if (state.modeState) {
        delete state.modeState.players[event.id];
        delete state.modeState.grapples[event.id];
        state.modeState.projectiles = state.modeState.projectiles.filter(arrow => arrow.owner !== event.id);
      }
    }
  }
}

function stepFrame(frame) {
  inputSnapshots[frame] = cloneInputs();
  for (const change of inputList[frame] || []) {
    if (!change) continue;
    const [id, key, pressed] = change;
    ensureInputSlot(id);
    currentInputs[id][key] = pressed;
  }
  applyEvents(frame);
  gameStateList[frame + 1] = physics.step(1 / 30, gameStateList[frame], currentInputs);
}

function recalculate() {
  const from = recalculationFrame;
  recalculationFrame = Infinity;
  if (from < oldestFrame || !gameStateList[from] || !inputSnapshots[from]) {
    // The correction reaches further back than retained history; resynchronise instead of guessing.
    networking.requestInitialData();
    return;
  }
  restoreInputs(inputSnapshots[from]);
  for (let frame = from; frame < currentFrame; frame++) stepFrame(frame);
}

function prune() {
  const limit = currentFrame - HISTORY_FRAMES;
  while (oldestFrame < limit) {
    delete gameStateList[oldestFrame];
    delete inputSnapshots[oldestFrame];
    delete inputList[oldestFrame];
    delete eventList[oldestFrame];
    oldestFrame++;
  }
}

function sendSnapshot() {
  if (networking.id === null || networking.id !== snapshotAuthority) return;
  if (currentFrame - lastSnapshotFrame < SNAPSHOT_INTERVAL) return;
  const frame = currentFrame - CONFIRM_LAG;
  if (frame <= baseFrame || !gameStateList[frame] || !inputSnapshots[frame]) return;
  networking.socket.emit('snapshot', { frame, state: gameStateList[frame], inputs: inputSnapshots[frame] });
  lastSnapshotFrame = currentFrame;
}

// The room's map pool and the session's order through it. Every client works out a round's
// map from these rather than being told, which is how the original does it.
//
// The pool is a megabyte or so, so it is fetched as the page loads rather than when the room
// answers: waiting for it at that point would hold up the first simulated frame and leave the
// player looking at a game that has not started. By the time a map is actually needed — the
// end of the first round, which is a freeze plus a whole round away — it is long since here.
var quickMapPool = [];
var quickMapOrder = [];
// Which pool a room plays, from its id, so the fetch can start before the room has answered.
const POOL_FOR_ROOM = { 'quick-classic': 'classic', 'quick-arrows': 'arrows', 'quick-grapple': 'grapple' };
function poolForRoom(id) {
  if (typeof id !== 'string' || id === 'tutorial' || id.startsWith('tutorial-')) return null;
  const base = id.replace(/-\d+$/, '');
  return POOL_FOR_ROOM[base] || 'classic';
}

let loadedPoolName = null;
function loadMapPool(pool) {
  if (!pool || pool === loadedPoolName) return Promise.resolve();
  loadedPoolName = pool;
  return fetch(`/api/maps/${encodeURIComponent(pool)}`)
    .then(response => response.ok ? response.json() : [])
    .then(maps => { quickMapPool = maps; })
    .catch(() => { quickMapPool = []; loadedPoolName = null; });
}

// Start fetching before anything else happens on the page.
loadMapPool(poolForRoom(typeof roomId === 'string' ? roomId : null));

networking.on('initialData', (initialTimeStamp, timeStamp, data) => {
  // The order has to come from the room, since it is shuffled once per session. The pool
  // itself is normally already here; this only starts a fetch if the room plays a different
  // one than the room id suggested.
  quickMapOrder = Array.isArray(data.mapOrder) ? data.mapOrder : [];
  loadMapPool(data.mapPool);
  networking.id = data.id;
  // Who the exit button answers to. The game page is otherwise told nothing about hosts.
  window.bonkIsHost = data.isHost === true;
  window.bonkHasLobby = data.hasLobby === true;
  document.dispatchEvent(new CustomEvent('bonkRoleKnown'));
  snapshotAuthority = Number.isInteger(data.authority) ? data.authority : 0;
  activeMode = data.gameSettings?.mo || 'b';
  // The original's own fields. wl is clamped the way the lobby clamps it, except for the
  // 999 quick play uses to mean "no limit".
  const wl = Number(data.gameSettings?.wl);
  matchWinAmount = wl === 999 ? 999 : Math.min(Math.max(1, wl || 3), 9);
  matchTeams = data.gameSettings?.tea === true;
  matchQuick = Boolean(data.gameSettings?.q);
  // The tutorial is a solo course with its own checkpoints, so it has no round loop.
  matchEnabled = roomId !== 'tutorial';

  gameStateList.length = 0;
  eventList.length = 0;
  inputSnapshots.length = 0;
  baseFrame = Number.isInteger(data.baseFrame) ? data.baseFrame : 0;
  oldestFrame = baseFrame;
  currentFrame = baseFrame;
  gameStateList[baseFrame] = data.initialState;
  inputList = data.playerInputs || [];
  for (const event of data.events || []) if (event) (eventList[event.frame] ||= []).push(event);

  const base = data.baseInputs?.length ? data.baseInputs : data.initialState.discs.map(() => blankInput());
  restoreInputs(base);
  inputSnapshots[baseFrame] = cloneInputs();
  lastSnapshotFrame = baseFrame;
  recalculationFrame = Infinity;

  window.initialTimeStamp = initialTimeStamp;
  timeStampOLD = Date.now();
  // Catch up from the base frame to the room's shared clock.
  msPassed = networking.tsync.now() - initialTimeStamp - baseFrame * FRAME_MS;
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(stepFunc);
  }
});

networking.on('input', (id, key, pressed, frame) => {
  if (!INPUT_KEYS.includes(key) || !Number.isInteger(frame)) return;
  (inputList[frame] ||= []).push([id, key, pressed]);
  if (frame < currentFrame) invalidateFrom(frame);
});

networking.on('gameEvent', event => {
  if (!event || !Number.isInteger(event.frame)) return;
  (eventList[event.frame] ||= []).push(event);
  if (event.frame < currentFrame) invalidateFrom(event.frame);
});

networking.on('roomError', () => BonkNavigation.menu());
// The host ended the game: everyone goes back to the room's lobby, not to the menu.
networking.on('returnToLobby', ({ roomId: backTo }) => {
  sessionStorage.removeItem('bonkHostToken');
  sessionStorage.setItem('bonkPendingLobby', backTo);
  BonkNavigation.menu();
});

localInputs.onKeyChange((key, pressed) => {
  networking.sendInputChange(key, pressed, currentFrame);
  (inputList[currentFrame] ||= []).push([networking.id, key, pressed]);
  // The current frame has not been stepped yet. Its queued input will be
  // consumed on the next simulation step; rolling it back requests a reset
  // because no input snapshot exists for this frame yet.
});

// The simulation runs at 30 steps a second while the screen draws at whatever rate it likes,
// so drawing a step straight to the screen shows each one twice or more and movement reads as
// a series of jumps. What is drawn instead is the picture between the last two steps, moved
// on by however much of the next step's time has already passed. The simulation itself is
// untouched: this only decides where things are drawn.
//
// A step that says not to interpolate is drawn as it is — that flag is set when a round is
// rebuilt, where sliding from the old positions to the new ones would look like everything
// flying across the map.
function lerpAngle(from, to, alpha) {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference * alpha;
}

function viewState(frame, alpha) {
  const current = gameStateList[frame];
  const previous = gameStateList[frame - 1];
  if (!current || !previous || current.dontInterpolate) return current;
  const blend = Math.max(0, Math.min(1, alpha));
  if (blend <= 0) return previous;
  const mix = (from, to) => from + (to - from) * blend;
  // Box2D will not move a body more than two metres in a step, so anything that has moved
  // further than that was put there rather than travelled there: a respawn, a round reset,
  // a teleport. Those are drawn where they are. Without this the disc appears to glide
  // across the map from where it died to where it came back.
  const JUMPED = 3;
  const jumped = (fromX, fromY, toX, toY) =>
    Math.abs(toX - fromX) > JUMPED || Math.abs(toY - fromY) > JUMPED;

  const view = Object.create(current);
  view.discs = current.discs.map((disc, id) => {
    const was = previous.discs[id];
    // A disc that has only just appeared has nothing to come from.
    if (!disc || !was || jumped(was.x, was.y, disc.x, disc.y)) return disc;
    return Object.assign(Object.create(disc), {
      x: mix(was.x, disc.x), y: mix(was.y, disc.y), a: lerpAngle(was.a, disc.a, blend)
    });
  });
  view.physics = Object.create(current.physics);
  view.physics.bodies = current.physics.bodies.map((body, index) => {
    const was = previous.physics.bodies[index];
    if (!body || !was || jumped(was.p[0], was.p[1], body.p[0], body.p[1])) return body;
    return Object.assign(Object.create(body), {
      p: [mix(was.p[0], body.p[0]), mix(was.p[1], body.p[1])],
      a: lerpAngle(was.a, body.a, blend)
    });
  });
  if (current.modeState && previous.modeState) {
    view.modeState = Object.create(current.modeState);
    // Arrows are matched by their id, not their place in the list: an arrow expiring shifts
    // everything after it along, and matching by position would blend each one towards its
    // neighbour's old spot and look like it had jumped across the map.
    const before = new Map();
    for (const arrow of previous.modeState.projectiles) {
      if (arrow && arrow.id !== undefined) before.set(arrow.id, arrow);
    }
    view.modeState.projectiles = current.modeState.projectiles.map(arrow => {
      const was = arrow && arrow.id !== undefined ? before.get(arrow.id) : null;
      if (!arrow || !was || jumped(was.x, was.y, arrow.x, arrow.y)) return arrow;
      return Object.assign(Object.create(arrow), {
        x: mix(was.x, arrow.x), y: mix(was.y, arrow.y), a: lerpAngle(was.a, arrow.a, blend)
      });
    });
  }
  return view;
}

function stepFunc() {
  if (recalculationFrame !== Infinity) recalculate();

  const currentTS = Date.now();
  msPassed += currentTS - timeStampOLD;
  timeStampOLD = currentTS;
  while (msPassed > FRAME_MS) {
    msPassed -= FRAME_MS;
    if (!gameStateList[currentFrame + 1]) stepFrame(currentFrame);
    currentFrame++;
  }
  prune();
  sendSnapshot();
  if (gameStateList[currentFrame]) graphics.render(viewState(currentFrame, msPassed / FRAME_MS));
  requestAnimationFrame(stepFunc);
}

window.addEventListener('keydown', event => {
  if (event.code === 'KeyR' && event.ctrlKey) networking.requestInitialData();
});
