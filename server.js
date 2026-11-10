'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { practiceCourse, stateFromMap, pickSpawn, masterMapOrder, poolOrder, poolFor,
  officialPool, officialMap } = require('./src/maps.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { allowEIO3: true });
const PORT = Number(process.env.PORT) || 3000;
// How long a room is held open while it has nobody in it: long enough to cover a new
// room waiting for its host and a lobby handing its players over to the game page.
const ROOM_GRACE_MS = 30000;
// How often rooms nobody ever joined are looked for. Collection also runs on every
// disconnect, so this only catches rooms that empty without one.
const ROOM_SWEEP_MS = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));
app.use('/reference', express.static(path.join(__dirname, 'resources/source')));
app.use('/engine', express.static(path.join(__dirname, 'resources/accurateclone/client')));
// Mode codes and the 'ga'/'mo' pairing come from resources/packets/Packets.md packet 20.
// Labels, lobby element ids and menu order were read from the live lobby's own mode menu,
// which lists exactly: Classic, Arrows, Death Arrows, Grapple, VTOL, Football.
// 'available' is false where this build has no implementation; it is listed, not faked.
const MODES = {
  b: { name: 'Classic', ga: 'b', lobbyId: 'newbonklobby_mode_classic', lobby: true, available: true },
  ar: { name: 'Arrows', ga: 'b', lobbyId: 'newbonklobby_mode_arrow', lobby: true, available: true },
  ard: { name: 'Death Arrows', ga: 'b', lobbyId: 'newbonklobby_mode_deatharrows', lobby: true, available: true },
  sp: { name: 'Grapple', ga: 'b', lobbyId: 'newbonklobby_mode_grapple', lobby: true, available: true },
  v: { name: 'VTOL', ga: 'b', lobbyId: 'newbonklobby_mode_vtol', lobby: true, available: false },
  f: { name: 'Football', ga: 'f', lobbyId: 'newbonklobby_mode_football', lobby: true, available: false },
  // Simple is a documented mode code that the lobby mode menu does not list.
  bs: { name: 'Simple', ga: 'b', lobby: false, available: true }
};
function lobbyModes() {
  return Object.entries(MODES)
    .filter(([, mode]) => mode.lobby)
    .map(([code, mode]) => ({ code, name: mode.name, id: mode.lobbyId, available: mode.available }));
}
const FRAME_MS = 1000 / 30;
// Lead frames give every client time to receive a roster change before simulating it.
const EVENT_LEAD = 15;
// The original's quick-play type names, which also pick the map pool for the mode.
const QUICK_TYPES = { b: 'bonkquick', ar: 'arrowsquick', sp: 'grapplequick' };

function defaultSettings(mode = 'b', quick = false) {
  // Field names follow the documented game-settings object: ga, mo, wl (rounds to win),
  // tea (teams), tl (team lock), gt, q, bal. 'mode' is this build's display label.
  // Quick play carries the original's values: the mode's pool name in q, and wl 999, which
  // is how the original says a quick match has no round limit and never ends.
  return { ga: MODES[mode].ga, mo: mode, mode: MODES[mode].name,
    wl: quick ? 999 : 3, tea: false, tl: false, gt: 2,
    q: quick ? QUICK_TYPES[mode] || 'bonkquick' : false, bal: [] };
}

// A round opens with a full ability meter, except in the arrows modes, which start half
// charged so nobody can fire the instant a round begins.
function startingMeter(state) {
  const mode = state && state.mm && state.mm.mo;
  if (mode === 'ar' || mode === 'ard') return 500;
  return 1000;
}

// Discs spawn from the map's own spawn list, using the documented team flags and priority.
function makeDisc(state, { index = 0, team = 0 } = {}) {
  const spawn = pickSpawn(state.spawns || [], { team, index });
  return {
    x: spawn.x, y: spawn.y,
    xv: spawn.xv, yv: spawn.yv, a: 0, av: 0, a1a: startingMeter(state), team,
    // The original's aim and draw: straight up, undrawn.
    da: 270, ds: 0,
    ni: false, sx: spawn.x, sy: spawn.y,
    sxv: spawn.xv, syv: spawn.yv, ds: 0, da: 270, lhid: -1, lht: 0
  };
}

const practiceMap = practiceCourse();
const practiceState = stateFromMap(practiceMap);
// The tutorial is a solo course with no rounds, so it has no round-in countdown and is never
// frozen: the player has control from the moment it opens.
practiceState.ftu = -1;

// One shuffled map order for the whole session, which every room walks. This is how the
// original picks maps: a map is a function of the round number, not of what came before, so
// a client that rolls back cannot drift onto a different map.
const sessionMapOrder = masterMapOrder();
const poolOrders = {
  classic: poolOrder(sessionMapOrder, 'classic'),
  arrows: poolOrder(sessionMapOrder, 'arrows'),
  grapple: poolOrder(sessionMapOrder, 'grapple')
};

// The map a mode plays on a given round, and a fresh state built from it.
function roundMapIndex(mode, round = 0) {
  const order = poolOrders[poolFor(mode)];
  return order[round % order.length];
}
function roundMap(mode, round = 0) {
  return officialMap(poolFor(mode), roundMapIndex(mode, round));
}
// A state built from one map of a pool, named by its index in that pool.
//
// The index travels in the state because the map does not: every client carries its own
// copy of the pool (`/api/maps/:pool`), so naming the map is enough for all of them to put
// that same map back at the start of each round without a map ever going into a snapshot.
function stateForMap(pool, index) {
  const map = officialMap(pool, index);
  if (!map) return null;
  const state = stateFromMap(map);
  // officialMap wraps past the end of the list; the state carries the wrapped index, so a
  // client looking the map up in its own copy of the pool finds the same one.
  const length = officialPool(pool).length;
  state.mapIndex = ((index % length) + length) % length;
  return state;
}
function roundState(mode, round = 0) {
  return stateForMap(poolFor(mode), roundMapIndex(mode, round));
}
// Exported for tests that check the state is built the documented way.
const initialState = roundState('b', 0);
// Which map the next menu background shows. It walks the same session order the rounds
// do, so the menu is not always the same map.
let previewCount = 0;


// The tutorial runs in its own room, created per player.
function isTutorialRoom(room) {
  return room.id === 'tutorial' || room.id.startsWith('tutorial-');
}

function nextPlayerId(players) {
  const free = players.findIndex(value => !value);
  return free === -1 ? players.length : free;
}

function createRoom({ id, name, password = '', maxPlayers = 8, minLevel = 0, maxLevel = 999, unlisted = false, mode = 'b', quick = false }) {
  return {
    id,
    name,
    password,
    maxPlayers,
    minLevel,
    maxLevel,
    unlisted,
    settings: defaultSettings(mode, quick),
    startTime: null,
    // How many games this room has opened, which picks the map each one starts on.
    gameCount: 0,
    players: [],
    playerInputs: [],
    // Roster changes are timeline events so every client applies them on the same frame.
    events: [],
    // base is the oldest state every client can still reconstruct from: frame 0, or a host snapshot.
    base: { frame: 0, inputs: [] },
    // Map votes for the room's current map, by socket id.
    votes: { up: [], down: [], fav: [] },
    state: roundState(mode, 0),
    lobbyUsers: [],
    startTimer: null,
    // A room exists only while someone is in it, so a brand new one would be collected
    // before its first player could arrive. keepUntil holds it open until then, and is
    // cleared the moment anyone joins. See collectRoom.
    keepUntil: Date.now() + ROOM_GRACE_MS,
    // Whether anyone has ever been in it. A room still waiting for the host who made it
    // is not listed in the browser: an empty row nobody can be in is the thing we are
    // getting rid of.
    joined: false
  };
}

function roomFrame(room) {
  return room.startTime === null ? 0 : Math.floor((Date.now() - room.startTime) / FRAME_MS);
}

function activePlayers(room) {
  return room.players.filter(Boolean).length;
}

// An empty room is not a room: once the last player or lobby member goes, it stops
// existing rather than lingering in the browser with nobody in it. Two moments are
// genuinely empty without being over, and keepUntil covers both: a room that has just
// been created and is waiting for its host, and a lobby that has just started a game,
// whose players drop their lobby socket to load the game page and arrive a moment later.
// ROOM_GRACE_MS is this server's own allowance for those two gaps, not a number from the
// original.
function roomOccupied(room) {
  return activePlayers(room) > 0 || room.lobbyUsers.length > 0;
}

function collectRoom(room) {
  if (!room || !rooms.has(room.id)) return false;
  if (roomOccupied(room) || Date.now() < (room.keepUntil || 0)) return false;
  if (room.startTimer) {
    clearInterval(room.startTimer);
    room.startTimer = null;
  }
  rooms.delete(room.id);
  return true;
}

// The lowest active player id is the snapshot authority, so late joiners skip replaying a whole match.
function authorityId(room) {
  return room.players.findIndex(Boolean);
}

function addEvent(room, event) {
  room.events.push(event);
  return event;
}

// No rooms exist until someone asks for one. Quick Play used to open three here and the
// tutorial a fourth, all with nobody in them; they are made on demand instead.
// The lobby's status lines, word for word and colour for colour from the original's own
// showStatusMessage calls. Every one is prefixed "* ". Roster and room events are
// #b53030; the countdown and other notices are #0955c7; being handed host is #800d6e.
// withSound matches the original's third argument.
const STATUS = {
  joined: name => ({ system: true, text: `* ${name} has joined the game`, color: '#b53030', sound: true }),
  left: name => ({ system: true, text: `* ${name} has left the game`, color: '#b53030', sound: true }),
  hostLeftClosed: name => ({ system: true, text: `* ${name} has left the game and closed the room.`, color: '#b53030', sound: true }),
  hostLeftTo: (name, next) => ({ system: true, text: `* ${name} has left the game and ${next} is now the game host.`, color: '#b53030', sound: true }),
  youAreHost: () => ({ system: true, text: '* You are now the host of this game.', color: '#800d6e', sound: false }),
  countdown: remaining => ({ system: true, text: `* Game starting in ${remaining}`, color: '#0955c7', sound: false }),
  countdownAborted: () => ({ system: true, text: '* Countdown aborted!', color: '#0955c7', sound: false })
};

// Going into a game and coming back is not arriving, and is not leaving.
//
// The lobby and the game are separate pages here, so starting a game drops every lobby
// socket and ending one drops every game socket, and each player then connects again on the
// other side with a new id. Nothing about that is a roster change, but the lobby's own
// handlers cannot tell: without this, a game handed back to its lobby opens on a column of
// "has joined the game" for players who never went anywhere.
//
// So the two places that cause a handoff open one, naming the players it expects to see
// again. Each name is spent as that player goes or returns, which leaves anybody else
// joining or leaving in the meantime announced as normal, and the window lapses either way.
function openHandoff(room, names) {
  const expected = new Map();
  for (const name of names) expected.set(name, (expected.get(name) || 0) + 1);
  room.handoff = expected.size ? { until: Date.now() + ROOM_GRACE_MS, names: expected } : null;
}
// True when this player is one the room is waiting on, and so is not announced.
function spendHandoff(room, name) {
  const handoff = room.handoff;
  if (!handoff) return false;
  if (handoff.until <= Date.now()) {
    room.handoff = null;
    return false;
  }
  const expected = handoff.names.get(name) || 0;
  if (!expected) return false;
  if (expected > 1) handoff.names.set(name, expected - 1);
  else handoff.names.delete(name);
  if (handoff.names.size === 0) room.handoff = null;
  return true;
}

const rooms = new Map();
// Rooms nobody ever joined are the one case no disconnect will clean up.
const roomSweeper = setInterval(() => {
  for (const room of [...rooms.values()]) collectRoom(room);
}, ROOM_SWEEP_MS);
// Never hold the process open for this; tests import this file and must still exit.
roomSweeper.unref?.();

// Each Quick Play mode can have several independent matches. Fill an existing
// match before opening another one; selection happens synchronously on connect.
function quickPlayRoom(requestedId) {
  const mode = { 'quick-classic': 'b', 'quick-arrows': 'ar', 'quick-grapple': 'sp' }[requestedId];
  if (!mode) return rooms.get(requestedId);
  for (const room of rooms.values()) {
    if ((room.id === requestedId || room.id.startsWith(`${requestedId}-`)) && activePlayers(room) < room.maxPlayers) return room;
  }
  // The plain id first, then -2, -3 and so on, so a room collected when it emptied gives
  // its name back rather than leaving a gap.
  let id = requestedId;
  if (rooms.has(id)) {
    let suffix = 2;
    while (rooms.has(`${requestedId}-${suffix}`)) suffix++;
    id = `${requestedId}-${suffix}`;
  }
  const room = createRoom({ id, name: 'Quick Play', mode, unlisted: true, quick: true });
  rooms.set(room.id, room);
  return room;
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    players: Math.max(activePlayers(room), room.lobbyUsers.length),
    maxPlayers: room.maxPlayers,
    mode: room.settings.mode,
    passworded: Boolean(room.password),
    level: room.minLevel === 0 && room.maxLevel === 999 ? 'Any level' : `${room.minLevel}-${room.maxLevel}`,
    distance: 'Local'
  };
}

app.get('/health', (_req, res) => res.json({
  ok: true,
  players: [...rooms.values()].reduce((total, room) => total + room.players.filter(Boolean).length, 0)
}));
// A mode's map pool, which a client fetches once so it can work out each round's map itself.
app.get('/api/maps/:pool', (req, res) => {
  const pool = officialPool(req.params.pool);
  if (!pool.length) return res.status(404).json({ error: 'unknown pool' });
  res.json(pool.map(entry => entry.map));
});
app.get('/api/rooms', (_req, res) => res.json([...rooms.values()].filter(room => !room.unlisted && room.joined).map(publicRoom)));
app.post('/api/rooms', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 30);
  const maxPlayers = Number(req.body?.maxPlayers);
  const minLevel = Number(req.body?.minLevel);
  const maxLevel = Number(req.body?.maxLevel);
  if (!name) return res.status(400).json({ error: 'Game name is required' });
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) return res.status(400).json({ error: 'Max players must be from 2 to 8' });
  if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel) || minLevel < 0 || maxLevel < minLevel || maxLevel > 999) return res.status(400).json({ error: 'Invalid level range' });
  const id = `room-${Math.random().toString(36).slice(2, 8)}`;
  const room = createRoom({
    id,
    name,
    password: String(req.body?.password || '').slice(0, 30),
    maxPlayers,
    minLevel,
    maxLevel,
    unlisted: req.body?.unlisted === true
  });
  rooms.set(id, room);
  return res.status(201).json(publicRoom(room));
});
app.post('/api/rooms/:id/join', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Game not found' });
  if (Math.max(activePlayers(room), room.lobbyUsers.length) >= room.maxPlayers) return res.status(409).json({ error: 'Game is full' });
  if (room.password && String(req.body?.password || '') !== room.password) return res.status(403).json({ error: 'Incorrect password' });
  return res.json({ ok: true, roomId: room.id });
});

io.on('connection', socket => {
  if (socket.handshake.auth?.preview === true) {
    // The menu background is this build's only replay, and it had two faults: it always
    // showed the one map picked at boot, and it inherited that round's 90-frame freeze,
    // so every visit to the menu opened on a still image for three seconds.
    // A replay is tied to its own map, and a frozen round is not part of it.
    previewCount += 1;
    const previewState = roundState('b', previewCount);
    // ftu is the round-start freeze; -1 is the original's "running". A replay never
    // shows the frozen frames.
    previewState.ftu = -1;
    previewState.discs = [makeDisc(previewState, { index: 0 })];
    previewState.players = [{ id: 0, team: 0 }];
    previewState.scores = [0];
    socket.on('timesync', data => socket.emit('timesync', { id: data && 'id' in data ? data.id : null, result: Date.now() }));
    socket.on('checkConnect', () => socket.emit('connectSuccess'));
    socket.on('getInitialData', () => socket.emit('initialData', Date.now(), Date.now(), {
      id: 0,
      players: [{ name: 'Preview', guest: true, level: 0 }],
      gameSettings: defaultSettings('bs'),
      playerInputs: [],
      events: [],
      initialState: previewState,
      baseFrame: 0,
      baseInputs: [],
      authority: 0
    }));
    return;
  }
  if (socket.handshake.auth?.lobby === true) {
    const roomId = String(socket.handshake.auth?.roomId || '');
    const room = rooms.get(roomId);
    if (!room || room.lobbyUsers.length >= room.maxPlayers) {
      socket.emit('roomError', room ? 'Game is full' : 'Game not found');
      socket.disconnect(true);
      return;
    }
    // team 0 is free-for-all; 1..4 are red, blue, green and yellow, as in the documented spawn flags.
    const user = { id: socket.id, name: String(socket.handshake.auth?.name || 'New Player').slice(0, 20),
      color: /^#[0-9a-f]{6}$/i.test(socket.handshake.auth?.color) ? socket.handshake.auth.color : '#5555ff',
      ready: false, team: 0, spectating: false };
    room.lobbyUsers.push(user);
    room.keepUntil = 0;
    room.joined = true;
    socket.join(`lobby:${roomId}`);
    const sendState = () => io.to(`lobby:${roomId}`).emit('lobbyState', {
      users: room.lobbyUsers,
      hostId: room.lobbyUsers[0]?.id || null,
      room: publicRoom(room),
      settings: room.settings,
      modes: lobbyModes(),
      map: room.state.mm,
      mapPhysics: room.state.physics,
      maps: officialPool(poolFor(room.settings.mo))
        .map((entry, index) => ({ index, name: entry.map.m.n, author: entry.map.m.a })),
      votes: { up: room.votes.up.length, down: room.votes.down.length, fav: room.votes.fav.length,
        mine: ['up', 'down', 'fav'].filter(kind => room.votes[kind].includes(socket.id)) }
    });
    // The original announces each arrival and departure in the chat as a status line.
    // The wording and the colour are its own; see comparisons/lobby-evidence.md.
    // To the others, not to the person arriving: the original raises this from the
    // "player joined" event the rest of the room receives.
    //
    // A player the room is holding a handoff open for is coming back from its own game,
    // not arriving, so they are not announced. See openHandoff.
    if (!spendHandoff(room, user.name)) {
      socket.to(`lobby:${roomId}`).emit('lobbyChat', STATUS.joined(user.name));
    }
    sendState();
    socket.on('lobbyReady', ready => {
      user.ready = ready === true;
      sendState();
    });
    socket.on('lobbyParticipation', spectating => {
      if (typeof spectating !== 'boolean') return;
      user.spectating = spectating;
      user.ready = false;
      sendState();
    });
    socket.on('lobbySettings', change => {
      if (room.lobbyUsers[0]?.id !== socket.id || !change) return;
      if (typeof change.mo === 'string' && MODES[change.mo]?.available) {
        const before = poolFor(room.settings.mo);
        room.settings.mo = change.mo;
        room.settings.ga = MODES[change.mo].ga;
        room.settings.mode = MODES[change.mo].name;
        // Each mode plays its own pool, and the same index is a different map in each, so a
        // map index kept across the change would name a map the lobby is not showing. Take
        // this pool's first map in the session order instead, which is what a room of this
        // mode would have opened on, and the preview and the game stay the one map.
        const pool = poolFor(change.mo);
        if (pool !== before) {
          const opening = stateForMap(pool, roundMapIndex(change.mo, 0));
          if (opening) room.state = opening;
        }
      }
      // The original's lobby clamps a typed round count to 1..9.
      const rounds = Number(change.wl);
      if (Number.isInteger(rounds)) room.settings.wl = Math.min(Math.max(1, rounds), 9);
      if (typeof change.tea === 'boolean' && room.settings.tea !== change.tea) {
        room.settings.tea = change.tea;
        for (const player of room.lobbyUsers) {
          player.team = 0;
          player.ready = false;
          if (change.tea) player.spectating = true;
        }
      }
      if (typeof change.tl === 'boolean') room.settings.tl = change.tl;
      sendState();
    });
    socket.on('lobbyMap', index => {
      if (room.lobbyUsers[0]?.id !== socket.id || !Number.isInteger(index)) return;
      const pool = poolFor(room.settings.mo);
      if (index < 0 || index >= officialPool(pool).length) return;
      const chosen = stateForMap(pool, index);
      if (!chosen) return;
      room.state = chosen;
      room.votes = { up: [], down: [], fav: [] };
      sendState();
    });
    // A player who is not the host does not set the map: choosing one sends everybody a
    // suggestion in the chat instead. The original's own split -- host sends the map,
    // anyone else sends a suggestion.
    socket.on('lobbyMapSuggest', index => {
      if (!Number.isInteger(index)) return;
      const pool = poolFor(room.settings.mo);
      if (index < 0 || index >= officialPool(pool).length) return;
      const entry = officialPool(pool)[index];
      io.to(`lobby:${roomId}`).emit('lobbyMapSuggest', {
        name: user.name, map: entry.map.m.n, author: entry.map.m.a
      });
    });
    socket.on('lobbyTeam', team => {
      const value = Number(team);
      if (!Number.isInteger(value) || value < 0 || value > 4) return;
      // A locked lobby only lets the host move players between teams.
      if (room.settings.tl && room.lobbyUsers[0]?.id !== socket.id) return;
      user.team = value;
      user.spectating = false;
      sendState();
    });
    socket.on('lobbyVote', kind => {
      if (!['up', 'down', 'fav'].includes(kind)) return;
      const opposite = kind === 'up' ? 'down' : kind === 'down' ? 'up' : null;
      const list = room.votes[kind];
      const at = list.indexOf(socket.id);
      if (at === -1) {
        list.push(socket.id);
        if (opposite) room.votes[opposite] = room.votes[opposite].filter(id => id !== socket.id);
      } else list.splice(at, 1);
      sendState();
    });
    socket.on('lobbyChat', message => {
      const text = String(message || '').trim().slice(0, 120);
      if (text) io.to(`lobby:${roomId}`).emit('lobbyChat', { name: user.name, color: user.color, text });
    });
    // Everyone is about to drop their lobby socket to load the game page, which leaves
    // the room briefly empty. Hold it open until they arrive, and mint the host token:
    // the lobby sockets all go away and come back as game sockets with new ids, so a
    // one-time token handed only to the host is what identifies them on the other side.
    const beginGame = () => {
      room.keepUntil = Date.now() + ROOM_GRACE_MS;
      // Every one of them is about to drop their lobby socket, which is not any of them
      // leaving the game.
      openHandoff(room, room.lobbyUsers.map(player => player.name));
      room.hostToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      room.hostSocketId = null;
      socket.emit('lobbyStart', { roomId, hostToken: room.hostToken });
      socket.to(`lobby:${roomId}`).emit('lobbyStart', { roomId });
    };
    const abortCountdown = () => {
      clearInterval(room.startTimer);
      room.startTimer = null;
      io.to(`lobby:${roomId}`).emit('lobbyChat', STATUS.countdownAborted());
      // The host's button reads "Abort" while this runs; tell the room it is over so the
      // label goes back even when the cancel came from the server rather than the click.
      io.to(`lobby:${roomId}`).emit('lobbyCountdownAborted');
    };
    socket.on('lobbyStart', () => {
      if (room.lobbyUsers[0]?.id !== socket.id || room.startTimer || !room.lobbyUsers.some(player => !player.spectating)) return;
      // The original's own start handler counts the room and branches on it. The count is
      // every entry in the player list, spectators included -- it does not filter them --
      // and a room of one calls startGame directly, with no countdown at all. Only with
      // more than one does it set the 3 second countdown.
      if (room.lobbyUsers.length === 1) {
        beginGame();
        return;
      }
      let remaining = 3;
      const announce = () => io.to(`lobby:${roomId}`).emit('lobbyChat', STATUS.countdown(remaining));
      announce();
      room.startTimer = setInterval(() => {
        if (room.lobbyUsers[0]?.id !== socket.id) {
          abortCountdown();
          return;
        }
        if (--remaining > 0) announce();
        else {
          clearInterval(room.startTimer);
          room.startTimer = null;
          beginGame();
        }
      }, 1000);
    });
    // While a countdown runs the host's Start button reads "Abort", and pressing it then
    // cancels -- the original sends this as its own message rather than reusing start.
    socket.on('lobbyAbortCountdown', () => {
      if (room.lobbyUsers[0]?.id !== socket.id || !room.startTimer) return;
      abortCountdown();
    });
    socket.on('disconnect', () => {
      room.lobbyUsers = room.lobbyUsers.filter(item => item.id !== socket.id);
      for (const kind of ['up', 'down', 'fav']) room.votes[kind] = room.votes[kind].filter(id => id !== socket.id);
      if (collectRoom(room)) return;
      // Dropping the lobby socket to load the game page is not leaving the game.
      if (!spendHandoff(room, user.name)) {
        io.to(`lobby:${roomId}`).emit('lobbyChat', STATUS.left(user.name));
      }
      sendState();
    });
    return;
  }
  const requestedRoomId = String(socket.handshake.auth?.roomId || 'quick-classic');
  let room;
  if (requestedRoomId === 'tutorial') {
    room = createRoom({ id: `tutorial-${socket.id}`, name: 'Tutorial', mode: 'ar', maxPlayers: 2, unlisted: true });
    room.state = structuredClone(practiceState);
    rooms.set(room.id, room);
  } else room = quickPlayRoom(requestedRoomId);
  if (!room || activePlayers(room) >= room.maxPlayers) {
    socket.emit('roomError', room ? 'Game is full' : 'Game not found');
    socket.disconnect(true);
    return;
  }
  const roomId = room.id;
  room.keepUntil = 0;
  room.joined = true;
  // The one player holding the token the lobby handed out is this game's host.
  const isGameHost = Boolean(room.hostToken) &&
    String(socket.handshake.auth?.hostToken || '') === room.hostToken;
  if (isGameHost) room.hostSocketId = socket.id;
  socket.join(roomId);
  const firstPlayer = activePlayers(room) === 0;
  if (firstPlayer) {
    room.startTime = Date.now();
    room.playerInputs = [];
    room.events = [];
    room.base = { frame: 0, inputs: [] };
    // The map this game is played on. The tutorial is the exception: it is one fixed
    // course, and must never be handed a map from a pool.
    //
    // Quick play has no lobby to choose one, so it moves on to the next map in the
    // session's order each game rather than dropping everyone back onto the one they just
    // played. A custom room plays the map its lobby is showing -- the host's pick. This
    // used to take the session order's map in both cases, which threw the pick away and
    // started the game on some other map of the pool.
    //
    // Either way the state is rebuilt from the map rather than carried over from the last
    // game, so every body starts the game back on its own mark.
    if (!isTutorialRoom(room)) {
      room.gameCount = (room.gameCount || 0) + 1;
      const pool = poolFor(room.settings.mo);
      const picked = room.settings.q ? null : room.state?.mapIndex;
      const built = Number.isInteger(picked)
        ? stateForMap(pool, picked)
        : roundState(room.settings.mo, room.gameCount - 1);
      if (built) room.state = built;
    }
    room.state.discs = [];
    room.state.players = [];
    room.state.scores = [];
    // The original's round fields, back to how a game opens. The tutorial is the exception:
    // it has no rounds, so it never counts one in.
    room.state.fte = -1;
    room.state.ftu = isTutorialRoom(room) ? -1 : 90;
    room.state.rc = 0;
    room.state.rl = 0;
    room.state.lscr = -1;
    room.state.gameComplete = undefined;
    room.state.modeState = undefined;
  }
  const id = nextPlayerId(room.players);
  const requestedName = String(socket.handshake.auth?.name || `Guest ${id + 1}`).slice(0, 20);
  const requestedColor = /^#[0-9a-f]{6}$/i.test(socket.handshake.auth?.color) ? socket.handshake.auth.color : '#5555ff';
  // Teams are off by default, so players take free-for-all spawns.
  const requestedTeam = Number(socket.handshake.auth?.team);
  const chosen = Number.isInteger(requestedTeam) && requestedTeam >= 0 && requestedTeam <= 4
    ? requestedTeam : room.lobbyUsers.find(item => item.name === requestedName)?.team;
  const team = room.settings.tea ? (chosen || (id % 4) + 1) : 0;
  const profile = { id, team, name: requestedName, color: requestedColor };
  const disc = makeDisc(room.state, { index: id, team });
  room.players[id] = { name: requestedName, color: requestedColor, guest: true, level: 0 };

  if (firstPlayer) {
    // The opening roster belongs to the frame every client starts from.
    room.state.discs[id] = disc;
    room.state.players[id] = profile;
    room.state.scores[id] = 0;
    // The official tutorial's arrow section needs a target: a red disc on the red spawn that
    // never presses a key. It is part of the opening roster so rollback reproduces it.
    if (room.id === 'tutorial' || room.id.startsWith('tutorial-')) {
      // Team 1 is red here, which is the spawn the official course reserves for the bot.
      room.state.discs[1] = makeDisc(room.state, { index: 0, team: 1 });
      // The course's bot is a quarter larger than a player, so it reads as a punching bag.
      room.state.discs[1].r = 1.25;
      room.state.players[1] = { id: 1, team: 1, name: 'Enemy Player', color: '#f44336' };
      room.state.scores[1] = 0;
      room.players[1] = { name: 'Enemy Player', color: '#f44336', guest: true, level: 0, bot: true };
    }
  } else {
    const frame = roomFrame(room) + EVENT_LEAD;
    const event = addEvent(room, { frame, type: 'join', id, disc, player: profile });
    socket.to(roomId).emit('gameEvent', event);
  }

  socket.on('timesync', data => socket.emit('timesync', { id: data && 'id' in data ? data.id : null, result: Date.now() }));
  socket.on('checkConnect', () => socket.emit('connectSuccess'));
  socket.on('getInitialData', () => {
    socket.emit('initialData', room.startTime, Date.now(), {
      id,
      players: room.players,
      gameSettings: room.settings,
      playerInputs: room.playerInputs,
      events: room.events,
      initialState: structuredClone(room.base.state || room.state),
      baseFrame: room.base.frame,
      baseInputs: room.base.inputs,
      authority: authorityId(room),
      // Whether this player is the host, which decides what the exit button does.
      isHost: isGameHost,
      // A game started from a lobby can be returned to that lobby; Quick Play and the
      // tutorial have no lobby to go back to.
      hasLobby: Boolean(room.hostToken),
      // The pool this room plays and the session's order through it, so every client picks
      // the same map for a round without being told at the time. The tutorial is one fixed
      // course with no rounds, so it is given no pool at all.
      mapPool: isTutorialRoom(room) ? null : poolFor(room.settings.mo),
      mapOrder: isTutorialRoom(room) ? [] : poolOrders[poolFor(room.settings.mo)]
    });
  });
  // The host leaving a game does not ask and does not go to the menu: it stops the game
  // and puts everybody back in the room's lobby.
  socket.on('endGameToLobby', () => {
    if (!room.hostSocketId || socket.id !== room.hostSocketId) return;
    // Stop the running game. The room itself survives -- everyone is about to rejoin it
    // as a lobby, so hold it open across that handoff the same way starting one does.
    room.startTime = null;
    room.base = { frame: 0, inputs: [] };
    room.events = [];
    room.playerInputs = [];
    // Everyone in the game is about to arrive in the lobby again, which is not any of them
    // joining it. See openHandoff.
    openHandoff(room, room.players.filter(Boolean).map(player => player.name));
    room.players = [];
    room.hostToken = null;
    room.hostSocketId = null;
    room.keepUntil = Date.now() + ROOM_GRACE_MS;
    io.to(roomId).emit('returnToLobby', { roomId });
  });
  socket.on('input', (key, pressed, frame) => {
    const allowed = ['up', 'down', 'left', 'right', 'action1', 'action2'];
    if (!allowed.includes(key) || typeof pressed !== 'boolean' || !Number.isInteger(frame)) return;
    socket.to(roomId).emit('input', id, key, pressed, frame);
    (room.playerInputs[frame] ||= []).push([id, key, pressed]);
  });
  // The authority's confirmed state replaces frame 0 so later joiners replay seconds, not whole matches.
  socket.on('snapshot', payload => {
    if (authorityId(room) !== id || !payload) return;
    const frame = Number(payload.frame);
    if (!Number.isInteger(frame) || frame <= room.base.frame || frame > roomFrame(room)) return;
    if (!payload.state || !Array.isArray(payload.inputs)) return;
    room.base = { frame, state: payload.state, inputs: payload.inputs };
    room.events = room.events.filter(event => event.frame > frame);
    for (let past = 0; past < frame; past++) delete room.playerInputs[past];
  });
  socket.on('gameChat', message => {
    const text = String(message || '').trim().slice(0, 120);
    if (text) io.to(roomId).emit('gameChat', { name: requestedName, text });
  });
  socket.on('disconnect', () => {
    room.players[id] = undefined;
    if (activePlayers(room) === 0) {
      room.startTime = null;
      room.base = { frame: 0, inputs: [] };
      room.events = [];
      room.playerInputs = [];
      // Any room the last player leaves goes, not just Quick Play overflow and tutorials.
      // A room still inside its grace window survives and the sweeper takes it later.
      collectRoom(room);
      return;
    }
    const frame = roomFrame(room) + EVENT_LEAD;
    const event = addEvent(room, { frame, type: 'leave', id });
    socket.to(roomId).emit('gameEvent', event);
  });
});

// Only listen when started directly, so tests can import the room and map logic.
if (require.main === module) {
  server.listen(PORT, () => process.stdout.write(`Bonk recreation running at http://localhost:${PORT}\n`));
}

module.exports = { app, server, io, initialState, MODES, lobbyModes, defaultSettings, createRoom, roomFrame, quickPlayRoom, rooms, FRAME_MS, EVENT_LEAD };
