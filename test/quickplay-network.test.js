'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io, rooms, createRoom } = require('../server.js');

// Poll until a condition holds, so a test never races a message it is waiting on.
async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('Quick Play assigns real connections to a shared room and overflows when full', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  try {
    for (let index = 0; index < 9; index++) {
      const client = connect(url, { auth: { roomId: 'quick-grapple', name: `Player ${index}` },
        transports: ['websocket'], reconnection: false });
      clients.push(client);
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      // Ask after the server has installed the initial-data handler.
      const data = await new Promise(resolve => {
        client.once('initialData', (_start, _now, payload) => resolve(payload));
        client.emit('getInitialData');
      });
      assert.equal(data.id, index < 8 ? index : 0);
      assert.equal(data.gameSettings.mo, 'sp');
    }
    assert.equal(rooms.get('quick-grapple').players.filter(Boolean).length, 8);
    assert.equal(rooms.get('quick-grapple-2').players.filter(Boolean).length, 1);

    // The original's start handler counts the room and branches on it. A room of one
    // calls startGame directly: no countdown, and so no chat lines at all.
    const soloRoom = createRoom({ id: 'room-test-solo', name: 'Solo start test' });
    rooms.set(soloRoom.id, soloRoom);
    const solo = connect(url, { auth: { lobby: true, roomId: soloRoom.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    clients.push(solo);
    await new Promise(resolve => solo.once('lobbyState', resolve));
    const soloLines = [];
    solo.on('lobbyChat', message => { if (message.system) soloLines.push(message.text); });
    const soloStarted = new Promise(resolve => solo.once('lobbyStart', resolve));
    const soloAt = Date.now();
    solo.emit('lobbyStart');
    await soloStarted;
    assert.deepEqual(soloLines, [], 'a one-player room counts in nowhere');
    assert.ok(Date.now() - soloAt < 1000, 'and it starts at once rather than after 3s');

    // With more than one it sets the 3 second countdown.
    const room = createRoom({ id: 'room-test-countdown', name: 'Countdown test' });
    rooms.set(room.id, room);
    const host = connect(url, { auth: { lobby: true, roomId: room.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    clients.push(host);
    await new Promise(resolve => host.once('lobbyState', resolve));
    const announcements = [];
    const colours = [];
    host.on('lobbyChat', message => {
      if (!message.system) return;
      announcements.push(message.text);
      colours.push(message.color);
    });
    const guest = connect(url, { auth: { lobby: true, roomId: room.id, name: 'Guest' },
      transports: ['websocket'], reconnection: false });
    clients.push(guest);
    await new Promise(resolve => guest.once('lobbyState', resolve));
    // The guest's arrival is announced to the host. Wait for that line and drop it, so
    // what remains is the countdown alone rather than a race between the two.
    await waitFor(() => announcements.length > 0);
    announcements.length = 0;
    colours.length = 0;
    const started = new Promise(resolve => host.once('lobbyStart', resolve));
    host.emit('lobbyStart');
    await started;
    // The original's own wording and colour: "* Game starting in N", #0955c7, no "...".
    // The host sees no join line of their own -- arrivals are announced to the others.
    assert.deepEqual(announcements, ['* Game starting in 3', '* Game starting in 2', '* Game starting in 1']);
    assert.deepEqual(colours, ['#0955c7', '#0955c7', '#0955c7']);

    // Pressing Start again while the countdown runs cancels it: the original sends its
    // own abort message, and the room gets the "* Countdown aborted!" line.
    const abortRoom = createRoom({ id: 'room-test-abort', name: 'Abort test' });
    rooms.set(abortRoom.id, abortRoom);
    const abortHost = connect(url, { auth: { lobby: true, roomId: abortRoom.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    clients.push(abortHost);
    await new Promise(resolve => abortHost.once('lobbyState', resolve));
    const abortLines = [];
    abortHost.on('lobbyChat', message => { if (message.system) abortLines.push(message.text); });
    const abortGuest = connect(url, { auth: { lobby: true, roomId: abortRoom.id, name: 'Guest' },
      transports: ['websocket'], reconnection: false });
    clients.push(abortGuest);
    await new Promise(resolve => abortGuest.once('lobbyState', resolve));
    await waitFor(() => abortLines.length > 0);
    abortLines.length = 0;
    let abortStarted = false;
    abortHost.once('lobbyStart', () => { abortStarted = true; });
    const abortSignalled = new Promise(resolve => abortHost.once('lobbyCountdownAborted', resolve));
    abortHost.emit('lobbyStart');
    await new Promise(resolve => setTimeout(resolve, 1200));
    abortHost.emit('lobbyAbortCountdown');
    await abortSignalled;
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(abortStarted, false, 'an aborted countdown never starts the game');
    assert.ok(abortLines.includes('* Countdown aborted!'), 'and the room is told');
    assert.ok(!abortLines.includes('* Game starting in 1'), 'the countdown stopped where it was');
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});
