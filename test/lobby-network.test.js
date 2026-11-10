'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io, rooms, createRoom } = require('../server.js');
const { officialPool, poolFor } = require('../src/maps.js');

test('lobby synchronizes participation, ready, teams and host-only map settings', async () => {
  const room = createRoom({ id: 'lobby-verification', name: 'Verification' });
  rooms.set(room.id, room);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  try {
    async function join(name, color) {
      const socket = connect(url, { auth: { lobby: true, roomId: room.id, name, color }, transports: ['websocket'], reconnection: false });
      clients.push(socket);
      await new Promise(resolve => socket.once('lobbyState', resolve));
      return socket;
    }
    const host = await join('Host', '#112233');
    const guest = await join('Guest', '#abcdef');
    async function update(socket, event, value, matches) {
      const state = new Promise(resolve => {
        const receive = next => {
          if (!matches(next)) return;
          host.off('lobbyState', receive);
          resolve(next);
        };
        host.on('lobbyState', receive);
      });
      socket.emit(event, value);
      return state;
    }
    let state = await update(guest, 'lobbyParticipation', true, s => s.users.find(u => u.name === 'Guest')?.spectating === true);
    assert.equal(state.users.find(user => user.name === 'Guest').spectating, true);
    assert.equal(state.users.find(user => user.name === 'Guest').color, '#abcdef');
    state = await update(guest, 'lobbyParticipation', false, s => s.users.find(u => u.name === 'Guest')?.spectating === false);
    assert.equal(state.users.find(user => user.name === 'Guest').spectating, false);
    state = await update(guest, 'lobbyReady', true, s => s.users.find(u => u.name === 'Guest')?.ready === true);
    assert.equal(state.users.find(user => user.name === 'Guest').ready, true);
    state = await update(host, 'lobbySettings', { tea: true }, s => s.settings.tea === true);
    assert.equal(state.settings.tea, true);
    assert.ok(state.users.every(user => user.spectating && user.team === 0 && !user.ready));
    state = await update(guest, 'lobbyTeam', 2, s => s.users.find(u => u.name === 'Guest')?.team === 2);
    assert.equal(state.users.find(user => user.name === 'Guest').team, 2);
    assert.equal(state.users.find(user => user.name === 'Guest').spectating, false);
    // Only the host may change the map, and the choice is an index into the mode's pool.
    const chosen = officialPool(poolFor('b'))[1].map.m.n;
    guest.emit('lobbyMap', 2);
    state = await update(host, 'lobbyMap', 1, s => s.map.n === chosen);
    assert.equal(state.map.n, chosen);
    assert.equal(state.hostId, host.id);
  } finally {
    for (const socket of clients) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});

test('the lobby announces arrivals, departures and map suggestions the original\'s way', async () => {
  const room = createRoom({ id: 'lobby-status-lines', name: 'Status lines' });
  rooms.set(room.id, room);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const join = async name => {
    const socket = connect(url, { auth: { lobby: true, roomId: room.id, name },
      transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise(resolve => socket.once('lobbyState', resolve));
    return socket;
  };
  const next = (socket, event) => new Promise((resolve, reject) => {
    socket.once(event, resolve);
    setTimeout(() => reject(new Error('no ' + event)), 5000);
  });
  try {
    const host = await join('Host');
    const seen = [];
    host.on('lobbyChat', message => { if (message.system) seen.push(message); });

    // Someone arriving is announced to the others, prefixed and coloured the
    // original's way. The person arriving is not told about themselves.
    const guestSeen = [];
    const guestChat = new Promise(resolve => setTimeout(resolve, 400));
    const guest = await join('Guest');
    guest.on('lobbyChat', message => { if (message.system) guestSeen.push(message); });
    await guestChat;
    assert.deepEqual(seen.map(m => m.text), ['* Guest has joined the game']);
    assert.equal(seen[0].color, '#b53030');
    assert.equal(seen[0].sound, true);
    assert.deepEqual(guestSeen, [], 'the arriving player gets no line about themselves');

    // A player who is not the host suggests a map rather than setting it.
    const pool = officialPool(poolFor(room.settings.mo));
    const mapBefore = room.state.mm.n;
    const suggestion = next(host, 'lobbyMapSuggest');
    guest.emit('lobbyMapSuggest', 3);
    const got = await suggestion;
    assert.equal(got.name, 'Guest');
    assert.equal(got.map, pool[3].map.m.n);
    assert.equal(got.author, pool[3].map.m.a);
    assert.equal(room.state.mm.n, mapBefore, 'a suggestion does not change the map');

    // And leaving is announced the same way.
    const left = next(host, 'lobbyChat');
    guest.disconnect();
    const leaveLine = await left;
    assert.equal(leaveLine.text, '* Guest has left the game');
    assert.equal(leaveLine.color, '#b53030');
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
    rooms.delete(room.id);
  }
});

test('the game is played on the map the lobby picked, not another one from the pool', async () => {
  const room = createRoom({ id: 'lobby-picked-map', name: 'Picked map' });
  rooms.set(room.id, room);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  try {
    const host = connect(url, { auth: { lobby: true, roomId: room.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    clients.push(host);
    await new Promise(resolve => host.once('lobbyState', resolve));

    // A map well down the pool, so the session order is very unlikely to name it anyway.
    const pool = officialPool(poolFor(room.settings.mo));
    const index = pool.length - 2;
    const picked = pool[index].map.m.n;
    const shown = await new Promise(resolve => {
      const receive = state => {
        if (state.map?.n !== picked) return;
        host.off('lobbyState', receive);
        resolve(state);
      };
      host.on('lobbyState', receive);
      host.emit('lobbyMap', index);
    });
    assert.equal(shown.map.n, picked, 'the lobby shows the pick');

    const started = new Promise(r => host.once('lobbyStart', r));
    host.emit('lobbyStart');
    const { hostToken } = await started;
    host.disconnect();

    const game = connect(url, { auth: { roomId: room.id, name: 'Host', hostToken },
      transports: ['websocket'], reconnection: false });
    clients.push(game);
    const data = await new Promise((resolve, reject) => {
      game.on('initialData', (_a, _b, payload) => resolve(payload));
      game.on('connect', () => game.emit('getInitialData'));
      setTimeout(() => reject(new Error('no initialData')), 8000);
    });
    assert.equal(data.initialState.mm.n, picked, 'and the game opens on it');
    // The index travels with the state so every client can put that same map back at the
    // start of each round from its own copy of the pool.
    assert.equal(data.initialState.mapIndex, index);
    assert.equal(data.mapPool, poolFor(room.settings.mo));
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
    rooms.delete(room.id);
  }
});

test('the host leaving a game ends it and returns everyone to the lobby', async () => {
  const room = createRoom({ id: 'lobby-host-exit', name: 'Host exit' });
  rooms.set(room.id, room);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const lobbyJoin = async name => {
    const socket = connect(url, { auth: { lobby: true, roomId: room.id, name },
      transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise(resolve => socket.once('lobbyState', resolve));
    return socket;
  };
  const gameJoin = async (name, hostToken) => {
    const socket = connect(url, { auth: { roomId: room.id, name, hostToken },
      transports: ['websocket'], reconnection: false });
    clients.push(socket);
    const data = await new Promise((resolve, reject) => {
      socket.on('initialData', (_a, _b, payload) => resolve(payload));
      socket.on('connect', () => socket.emit('getInitialData'));
      setTimeout(() => reject(new Error('no initialData for ' + name)), 8000);
    });
    return { socket, data };
  };
  try {
    const host = await lobbyJoin('Host');
    const guest = await lobbyJoin('Guest');
    // Only the host is handed a token when the game starts.
    const hostStart = new Promise(r => host.once('lobbyStart', r));
    const guestStart = new Promise(r => guest.once('lobbyStart', r));
    host.emit('lobbyStart');
    const [hostPayload, guestPayload] = await Promise.all([hostStart, guestStart]);
    assert.ok(hostPayload.hostToken, 'the host is given a token');
    assert.equal(guestPayload.hostToken, undefined, 'nobody else is');

    // Both drop their lobby sockets and come back as game sockets.
    host.disconnect();
    guest.disconnect();
    const hostGame = await gameJoin('Host', hostPayload.hostToken);
    const guestGame = await gameJoin('Guest', undefined);
    assert.equal(hostGame.data.isHost, true, 'the token identifies the host again');
    assert.equal(hostGame.data.hasLobby, true);
    assert.equal(guestGame.data.isHost, false, 'and nobody else is host');

    // A non-host asking to end the game is ignored.
    guestGame.socket.emit('endGameToLobby');
    await new Promise(r => setTimeout(r, 300));
    assert.notEqual(room.startTime, null, 'a non-host cannot end the game');

    // The host ending it tells everyone to go back to this room's lobby, and stops it.
    const hostBack = new Promise(r => hostGame.socket.once('returnToLobby', r));
    const guestBack = new Promise(r => guestGame.socket.once('returnToLobby', r));
    hostGame.socket.emit('endGameToLobby');
    const [a, b] = await Promise.all([hostBack, guestBack]);
    assert.equal(a.roomId, room.id);
    assert.equal(b.roomId, room.id);
    assert.equal(room.startTime, null, 'the game is stopped');
    assert.deepEqual(room.events, [], 'and its timeline cleared');
    assert.equal(rooms.has(room.id), true, 'the room survives for the lobby');
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
    rooms.delete(room.id);
  }
});

test('going into a game and back is not announced as leaving and joining', async () => {
  const room = createRoom({ id: 'lobby-handoff', name: 'Handoff' });
  rooms.set(room.id, room);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const lobbyJoin = async name => {
    const socket = connect(url, { auth: { lobby: true, roomId: room.id, name },
      transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise(resolve => socket.once('lobbyState', resolve));
    return socket;
  };
  const gameJoin = async (name, hostToken) => {
    const socket = connect(url, { auth: { roomId: room.id, name, hostToken },
      transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.on('initialData', () => resolve());
      socket.on('connect', () => socket.emit('getInitialData'));
      setTimeout(() => reject(new Error('no initialData for ' + name)), 8000);
    });
    return socket;
  };
  try {
    const host = await lobbyJoin('Host');
    const guest = await lobbyJoin('Guest');
    const started = Promise.all([new Promise(r => host.once('lobbyStart', r)),
      new Promise(r => guest.once('lobbyStart', r))]);
    host.emit('lobbyStart');
    const [{ hostToken }] = await started;

    // Into the game: both lobby sockets go, which is not either of them leaving.
    host.disconnect();
    guest.disconnect();
    const hostGame = await gameJoin('Host', hostToken);
    const guestGame = await gameJoin('Guest', undefined);

    // And back out of it again.
    const back = Promise.all([new Promise(r => hostGame.once('returnToLobby', r)),
      new Promise(r => guestGame.once('returnToLobby', r))]);
    hostGame.emit('endGameToLobby');
    await back;
    hostGame.disconnect();
    guestGame.disconnect();

    // The first one back watches the rest of the room arrive. None of them is an arrival.
    const hostAgain = await lobbyJoin('Host');
    const seen = [];
    hostAgain.on('lobbyChat', message => { if (message.system) seen.push(message.text); });
    await lobbyJoin('Guest');
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(seen, [], 'nobody coming back from the game is announced');

    // Somebody who really is new still is.
    await lobbyJoin('Newcomer');
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(seen, ['* Newcomer has joined the game']);
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
    rooms.delete(room.id);
  }
});

test('the menu background replay is map-specific and never frozen', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const preview = async () => {
    const socket = connect(url, { auth: { preview: true }, transports: ['websocket'], reconnection: false });
    clients.push(socket);
    const data = await new Promise((resolve, reject) => {
      socket.on('initialData', (_a, _b, payload) => resolve(payload));
      socket.on('connect', () => socket.emit('getInitialData'));
      setTimeout(() => reject(new Error('no initialData')), 8000);
    });
    socket.disconnect();
    return data.initialState;
  };
  try {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const state = await preview();
      // A replay is never shown frozen: ftu -1 is the original's "running".
      assert.equal(state.ftu, -1, 'the preview is not frozen');
      assert.ok(state.mm && typeof state.mm.n === 'string' && state.mm.n.length > 0);
      seen.push(state.mm.n);
    }
    // ...and it is tied to a map rather than always replaying the same one.
    assert.ok(new Set(seen).size > 1, `the preview varies its map, got ${seen.join(', ')}`);
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});
