'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
test('all runtime reference files exist', () => {
  const files = ['resources/accurateclone/client/physics.js','resources/accurateclone/client/libraries/Box2D.js','resources/accurateclone/client/libraries/pixi.min.js','resources/source/css/simplemenu.css','resources/source/fonts/futurept_7a255.otf'];
  for (const file of files) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('game page loads reference libraries and this build\'s adapted simulation', () => {
  const html = fs.readFileSync(path.join(root, 'client/game.html'), 'utf8');
  // Supplied unchanged from resources/.
  for (const script of ['/engine/libraries/Box2D.js','/engine/libraries/pixi.min.js','/engine/math.js','/engine/graphics.js','/engine/networking.js']) {
    assert.match(html, new RegExp(script.replace(/[./]/g, match => '\\' + match)));
  }
  // Adapted locally; see the header comments in each file for what differs.
  for (const script of ['/physics.js','/mode-runtime.js','/match.js','/game-loop.js']) {
    assert.match(html, new RegExp(`src="${script.replace(/[./]/g, match => '\\' + match)}"`));
  }
  assert.doesNotMatch(html, /\/engine\/bonk\.js/);
  assert.doesNotMatch(html, /\/engine\/physics\.js/);
});

test('menu uses selectors from the captured Bonk stylesheets', () => {
  const html = fs.readFileSync(path.join(root, 'client/menu.html'), 'utf8');
  for (const id of ['simpleMenuContainer','classic_mid_quickplay','classic_mid_customgame','roomListContainer','prettymenu']) assert.match(html, new RegExp(`id="${id}"`));
});

test('room list contains no fabricated static rooms', () => {
  const html = fs.readFileSync(path.join(root, 'client/menu.html'), 'utf8');
  for (const fakeRoom of ['Classic practice','bonk veterans','arrows only','death arrows','football lobby']) assert.doesNotMatch(html, new RegExp(fakeRoom));
  assert.match(html, /<tbody><\/tbody>/);
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  assert.match(shell, /fetch\('\/api\/rooms'\)/);
});

test('every official map is valid in the documented shape-fixture-body schema', () => {
  const maps = require(path.join(root, 'src/maps.js'));
  // The tutorial course is the official map, which is authored at ppm 10.
  assert.equal(maps.practiceCourse().physics.ppm, 10);
  const pools = ['classic', 'arrows', 'grapple'];
  const official = pools.flatMap(pool => maps.officialPool(pool).map(entry => entry.map));
  assert.equal(official.length, 289, 'all three pick pools are imported');
  for (const map of [...official, maps.practiceCourse()]) {
    assert.ok(map.physics.ppm > 0);
    assert.ok(map.physics.shapes.length > 0);
    assert.equal(map.physics.bro.length, map.physics.bodies.length, 'every body has a display order entry');
    for (const fixture of map.physics.fixtures) {
      assert.ok(map.physics.shapes[fixture.sh], 'fixture points at a real shape');
    }
    for (const body of map.physics.bodies) {
      assert.ok(['s', 'd', 'k'].includes(body.type), 'documented body type');
      for (const index of body.fx) assert.ok(map.physics.fixtures[index], 'body points at a real fixture');
    }
    for (const spawn of map.spawns) {
      assert.equal(typeof spawn.priority, 'number');
      assert.ok(['f', 'r', 'b', 'gr', 'ye'].some(flag => typeof spawn[flag] === 'boolean'));
    }
    for (const zone of map.capZones) {
      assert.ok(zone.ty >= 1 && zone.ty <= 5, 'documented cap zone type');
      assert.ok(map.physics.fixtures[zone.i], 'cap zone attaches to a real fixture');
    }
  }
});

test('maps survive the documented encode/decode format exactly', () => {
  const maps = require(path.join(root, 'src/maps.js'));
  const codec = require(path.join(root, 'src/map-codec.js'));
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value;
  const restored = codec.decode(codec.encode(maps.practiceCourse()));
  assert.deepEqual(canonical(restored), canonical(maps.practiceCourse()));

  // Every official map keeps its geometry through the format: shapes, fixtures, the bodies
  // they hang on, the spawns and the cap zones all come back identical. A map's gravity is
  // stored as a 32-bit float, so a map whose gravity came from the older Bonk 1 format can
  // come back a fraction out; that is the format's own precision, not a loss of map data.
  const geometry = map => JSON.stringify({
    bodies: map.physics.bodies.map(body => body && [body.p, body.a, body.fx]),
    shapes: map.physics.shapes,
    fixtures: map.physics.fixtures.map(fixture => [fixture.sh, fixture.d, fixture.np, fixture.ng]),
    spawns: map.spawns.map(spawn => [spawn.x, spawn.y, spawn.f, spawn.r, spawn.b]),
    capZones: map.capZones
  });
  for (const pool of ['classic', 'arrows', 'grapple']) {
    for (const entry of maps.officialPool(pool)) {
      assert.equal(geometry(codec.decode(codec.encode(entry.map))), geometry(entry.map),
        `${pool}: ${entry.map.m.n}`);
    }
  }
});

test('the decoder reads the real map payloads in the protocol documentation', () => {
  const codec = require(path.join(root, 'src/map-codec.js'));
  const docs = fs.readFileSync(path.join(root, 'resources/packets/Packets.md'), 'utf8');
  const codes = [...new Set([...docs.matchAll(/"map":"([A-Za-z0-9+/=_-]{40,})"/g)].map(match => match[1]))];
  assert.ok(codes.length > 0, 'the documentation contains encoded maps to test against');
  for (const code of codes) {
    const map = codec.decode(code);
    assert.ok(map.v > 0 && map.v <= codec.MAP_VERSION, 'a version the decoder knows');
    assert.equal(map.physics.ppm, 12);
    // Re-encoding a real payload must reproduce it byte for byte.
    assert.equal(codec.encode(map), code);
  }
});

test('help is a hint toggle and tutorial is a separate game', () => {
  const html = fs.readFileSync(path.join(root, 'client/menu.html'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  assert.doesNotMatch(html, /id="helpContainer"/);
  assert.doesNotMatch(html, /id="newPlayerGuideContainer"/);
  assert.match(shell, /classic_mid_tutorial[^\n]+launchRoom\('tutorial'\)/);
  assert.match(shell, /pretty_top_help_off/);
  assert.match(shell, /bonkHelpEnabled/);
});

test('the application shell keeps one address for menu and game', () => {
  const shell = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'client/app.js'), 'utf8');
  assert.match(shell, /id="appFrame"/);
  assert.match(app, /menu\.html/);
  assert.match(app, /game\.html/);
});

test('main menu is not hidden by a first-load session gate', () => {
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  assert.doesNotMatch(shell, /bonkGuestReady'\) !== 'true'/);
});

test('the tutorial course uses documented hazards, a finish zone and a spawn', () => {
  const maps = require(path.join(root, 'src/maps.js'));
  const course = maps.practiceCourse();
  assert.ok(course.physics.fixtures.some(fixture => fixture.d === true), 'hazards are death fixtures');
  assert.ok(course.capZones.length > 0, 'the finish is a cap zone');
  // The official course is "tut4_new": the player's spawn plus the red spawn for the bot
  // that the arrow section asks you to knock off.
  assert.equal(course.m.n, 'tut4_new');
  // Four spawns: the player's start, the bot's perch, and the two checkpoints the course
  // moves the player's spawn to as they get further along.
  assert.deepEqual(course.spawns.map(spawn => [spawn.x, spawn.y]),
    [[-69.5, 38], [106.5, 32.5], [3.5, 27], [83.5, 34]]);
  assert.ok(course.spawns[0].f && !course.spawns[0].r, 'the player takes the free-for-all spawn');
  assert.ok(course.spawns[1].r && !course.spawns[1].f, 'the bot takes the red spawn');
  assert.ok(course.spawns[2].f && course.spawns[3].f, 'the checkpoints are the player\'s own');
  // The course's last stretch is crossed on a body hung off a limited prismatic joint.
  assert.equal(course.physics.joints[0].type, 'lpj');
  assert.equal(course.physics.joints[0].pms, 0, 'it is still until the bot is down');
  const runtime = fs.readFileSync(path.join(root, 'client/game-runtime.js'), 'utf8');
  assert.match(runtime, /renderTutorial/);
  assert.match(runtime, /tutorialComplete/);
});

test('game canvas scales to the available viewport without changing aspect ratio', () => {
  const css = fs.readFileSync(path.join(root, 'client/game.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/game.html'), 'utf8');
  // The game fills the page top to bottom. The top bar floats over it and auto-hides,
  // so the canvas must not be inset by the bar's height or sized against what is left
  // below it.
  assert.match(css, /#gameMount\{position:absolute;inset:0;/);
  assert.match(css, /width:min\(100vw,calc\(100vh\*1\.46\)\)/);
  assert.match(css, /max-height:100vh/);
  assert.doesNotMatch(css, /#gameMount\{[^}]*inset:35px/);
  assert.doesNotMatch(css, /100vh - 35px/);
  assert.match(html, /this\.scaleRatio=1/);
});

test('menu and game share the reference top bar structure', () => {
  const menu = fs.readFileSync(path.join(root, 'client/menu.html'), 'utf8');
  const game = fs.readFileSync(path.join(root, 'client/game.html'), 'utf8');
  for (const id of ['prettymenu', 'pretty_top_bar', 'pretty_top_small_preview', 'pretty_top_name', 'pretty_top_level', 'pretty_top_playercount', 'pretty_top_help', 'pretty_top_replay', 'pretty_top_volume', 'pretty_top_settings', 'pretty_top_exit']) {
    assert.match(menu, new RegExp(`id="${id}"`));
    assert.match(game, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(game, /id="gameHud/);
});

test('rooms are built from an official map, not a placeholder', () => {
  const { initialState } = require(path.join(root, 'server.js'));
  const maps = require(path.join(root, 'src/maps.js'));
  assert.ok(initialState.spawns.length > 0, 'the state carries the map spawn list');
  assert.ok(initialState.physics.ppm > 0);
  // The room opens on a map from the pool the mode plays, picked by the session's order.
  const names = maps.officialPool('classic').map(entry => entry.map.m.n);
  assert.ok(names.includes(initialState.mm.n), `${initialState.mm.n} is a community pick`);
  // The map keeps its author field. One real community pick, "Overhead", has an empty
  // author, so the field has to be present rather than non-empty.
  assert.equal(typeof initialState.mm.a, 'string', 'the map keeps its author');
  // Most official maps have no death fixture at all: a knockout is the screen rule, which
  // lives in the round loop rather than in the map.
  const match = fs.readFileSync(path.join(root, 'client/match.js'), 'utf8');
  assert.match(match, /deathRadius/);
  assert.match(match, /screenHeight/);
  // The placeholder maps this project used to ship are gone from the pools entirely
  // (see comparisons/maps-evidence.md), which is what "not a placeholder" means here.
  // This used to assert bro !== [1, 0] as a stand-in for that, but the session picks its
  // first map at random and four real community picks -- The Ball-cher Knife, Grasstail,
  // Overhead and Simplex -- have exactly that body order, so the test failed about one
  // run in twenty for no reason.
  const placeholders = ['Open Arena', 'Open Arena 2', 'Open Arena 3'];
  for (const pool of ['classic', 'arrows', 'grapple']) {
    for (const entry of maps.officialPool(pool)) {
      assert.ok(!placeholders.includes(entry.map.m.n), `${entry.map.m.n} is a placeholder`);
    }
  }
});

test('multiplayer rooms share a stable simulation clock', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /room\.startTime = Date\.now\(\)/);
  assert.match(server, /socket\.emit\('initialData', room\.startTime, Date\.now\(\)/);
  assert.match(server, /playerInputs: room\.playerInputs/);
});

test('Quick Play fills a room before creating another and keeps rooms out of the browser', () => {
  const { rooms, quickPlayRoom } = require(path.join(root, 'server.js'));
  // Nothing exists until it is asked for, and the first room gets the plain id.
  assert.equal(rooms.has('quick-arrows'), false);
  const primary = quickPlayRoom('quick-arrows');
  try {
    assert.equal(primary.id, 'quick-arrows');
    primary.players = Array.from({ length: primary.maxPlayers - 1 }, () => ({}));
    assert.equal(quickPlayRoom('quick-arrows'), primary);
    primary.players.push({});
    const overflow = quickPlayRoom('quick-arrows');
    assert.notEqual(overflow, primary);
    assert.equal(overflow.id, 'quick-arrows-2');
    assert.equal(overflow.settings.mo, 'ar');
    assert.equal(overflow.unlisted, true);
    assert.equal(quickPlayRoom('quick-arrows'), overflow);
    assert.equal(primary.unlisted, true);
  } finally {
    rooms.delete('quick-arrows');
    rooms.delete('quick-arrows-2');
  }
});

test('a room with nobody in it stops existing', async () => {
  const { server, io, rooms, createRoom } = require(path.join(root, 'server.js'));
  const { io: connect } = require('socket.io-client');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const gone = id => new Promise(resolve => {
    const started = Date.now();
    const check = () => {
      if (!rooms.has(id) || Date.now() - started > 4000) return resolve(!rooms.has(id));
      setTimeout(check, 25);
    };
    check();
  });
  try {
    // A player leaving a game takes the game with them.
    const player = connect(url, { auth: { roomId: 'quick-classic', name: 'Solo' },
      transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      player.once('connect', resolve);
      player.once('connect_error', reject);
    });
    assert.equal(rooms.has('quick-classic'), true, 'the room exists while someone is in it');
    assert.equal(rooms.get('quick-classic').keepUntil, 0, 'joining spends the grace');
    player.disconnect();
    assert.equal(await gone('quick-classic'), true, 'the empty game room is removed');

    // The last person leaving a lobby takes the room with them, so the browser cannot
    // list a room with nobody in it.
    const custom = createRoom({ id: 'room-empty-test', name: 'Empty test' });
    rooms.set(custom.id, custom);
    const host = connect(url, { auth: { lobby: true, roomId: custom.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    await new Promise(resolve => host.once('lobbyState', resolve));
    assert.equal(rooms.has('room-empty-test'), true);
    host.disconnect();
    assert.equal(await gone('room-empty-test'), true, 'the empty lobby room is removed');

    // But a lobby that has just started a game is empty only because its players are
    // loading the game page. That room must survive the gap.
    const starting = createRoom({ id: 'room-handoff-test', name: 'Handoff test' });
    rooms.set(starting.id, starting);
    const leaving = connect(url, { auth: { lobby: true, roomId: starting.id, name: 'Host' },
      transports: ['websocket'], reconnection: false });
    await new Promise(resolve => leaving.once('lobbyState', resolve));
    await new Promise(resolve => { leaving.once('lobbyStart', resolve); leaving.emit('lobbyStart'); });
    leaving.disconnect();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(rooms.has('room-handoff-test'), true, 'a starting room survives the handoff');
    assert.ok(starting.keepUntil > Date.now(), 'and is held open while it waits');
  } finally {
    await new Promise(resolve => io.close(resolve));
    for (const id of ['quick-classic', 'room-empty-test', 'room-handoff-test']) rooms.delete(id);
  }
});

test('the lobby chat is reached with Enter, the way the original gates it', () => {
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  const reference = fs.readFileSync(path.join(root, 'resources/source/css/newbonklobby.css'), 'utf8');
  // The original's own rule: the input cannot be clicked into. If this ever stops being
  // true in the captured CSS the handler below is pointless, so assert it.
  assert.match(reference, /#newbonklobby_chat_input\s*\{[^}]*pointer-events:\s*none/);
  // ...and this build must not paper over it by deleting the rule.
  for (const file of ['client/shell.css', 'client/parity.css']) {
    const css = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(css, /#newbonklobby_chat_input[^}]*pointer-events:\s*auto/, file);
  }
  // Enter focuses it and turns pointer events on; Enter again sends, blurs and turns
  // them back off, restoring the "Press enter to send a message" line.
  assert.match(shell, /document\.addEventListener\('keydown'/);
  assert.match(shell, /input\.focus\(\)/);
  assert.match(shell, /input\.blur\(\)/);
  assert.match(shell, /pointerEvents = 'auto'/);
  assert.match(shell, /pointerEvents = 'none'/);
  assert.match(shell, /instruction\.style\.visibility = 'hidden'/);
  assert.match(shell, /instruction\.style\.visibility = 'inherit'/);
});

test('a non-host sees the original\'s greyed controls and suggests maps', () => {
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  const reference = fs.readFileSync(path.join(root, 'resources/source/css/pagelayout.css'), 'utf8');
  // The greyed look is the original's own class, not one of this build's.
  assert.match(reference, /\.brownButtonDisabled\s*\{[^}]*background-color:\s*#777777/);
  // Start, mode, editor and teams grey out; the map button never does.
  const block = shell.match(/for \(const id of \['newbonklobby_startbutton'[\s\S]{0,400}?\n    \}/);
  assert.ok(block, 'the non-host greying block is present');
  for (const id of ['newbonklobby_startbutton', 'newbonklobby_modebutton',
    'newbonklobby_editorbutton', 'newbonklobby_teamsbutton']) {
    assert.ok(block[0].includes(id), id + ' greys for a non-host');
  }
  assert.ok(!block[0].includes('newbonklobby_mapbutton'), 'the map button is never greyed');
  // Start is shown to everyone rather than hidden from non-hosts.
  assert.doesNotMatch(shell, /startbutton'\)\.style\.display = isHost/);
  // Choosing a map sets it as host and suggests it otherwise.
  assert.match(shell, /emit\(isHost \? 'lobbyMap' : 'lobbyMapSuggest', map\.index\)/);
  // The suggestion line uses the original's alternating classes.
  for (const cls of ['newbonklobby_mapsuggest_low', 'newbonklobby_mapsuggest_high']) {
    assert.match(shell, new RegExp(cls));
  }
  assert.match(shell, /' requests '/);
  // Opening the map window is not gated on being host either; only choosing differs.
  assert.doesNotMatch(shell, /if \(lobbyIsHost\) show\('localLobbyMapWindow'\)/);
});

test('game chat uses the captured Bonk chat DOM and classes', () => {
  const game = fs.readFileSync(path.join(root, 'client/game.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'client/game-ui.js'), 'utf8');
  for (const id of ['ingamechatbox', 'ingamechatcontent', 'ingamechatinputtext']) assert.match(game, new RegExp(`id="${id}"`));
  for (const className of ['ingamechatname', 'ingamechatmessage', 'ingamechatinputtextbg']) assert.match(ui, new RegExp(className));
  assert.doesNotMatch(game, /id="gameChat/);
});

test('leaving a game asks first, using the original\'s own Leave Game window', () => {
  const game = fs.readFileSync(path.join(root, 'client/game.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/game.css'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'client/game-ui.js'), 'utf8');
  const reference = fs.readFileSync(path.join(root, 'resources/source/css/pagelayout.css'), 'utf8');
  // The window is the original's, captured with its own ids and wording.
  for (const id of ['leaveconfirmwindowcontainer', 'leaveconfirmwindow', 'behindblocker',
    'leaveconfirmwindow_cancelbutton', 'leaveconfirmwindow_okbutton']) {
    assert.match(game, new RegExp(`id="${id}"`), id);
  }
  assert.match(game, /You are about to leave this game\./);
  assert.match(game, /Are you sure\?/);
  // Both buttons carry the classic skin's class, as the live page's own markup does, so
  // they are its #795548 brown rather than the bare .brownButton red underneath it.
  // Measured on bonk.io itself; see comparisons/exit-evidence.md.
  for (const id of ['leaveconfirmwindow_cancelbutton', 'leaveconfirmwindow_okbutton']) {
    assert.match(game, new RegExp(`id="${id}" class="brownButton brownButton_classic buttonShadow"`), id + ' is skinned');
  }
  // The original hides the window with visibility, not display, and this build must show it
  // the same way: a display-only toggle leaves pagelayout.css's visibility:hidden in force
  // and nothing ever appears on screen.
  assert.match(reference, /#leaveconfirmwindowcontainer\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /#leaveconfirmwindowcontainer\.open\{visibility:visible\}/);
  assert.doesNotMatch(css, /#leaveconfirmwindowcontainer\{[^}]*display:none/);
  // The window's geometry and colours belong to the original's stylesheet; this build must
  // not override them with its own.
  for (const invented of [/#leaveconfirmwindow\{[^}]*width:300px/, /background:#009688/,
    /#leaveconfirmwindow_text1\{margin-top/]) {
    assert.doesNotMatch(css, invented, String(invented));
  }
  // Exit asks first, and must not leave outright -- except the tutorial, which leaves at
  // once, and the host of a game started from a lobby, who ends the game instead.
  assert.match(ui, /roomId === 'tutorial'\) return BonkNavigation\.menu\(\)/);
  assert.match(ui, /window\.bonkIsHost && window\.bonkHasLobby/);
  assert.match(ui, /emit\('endGameToLobby'\)/);
  assert.match(ui, /leave\.classList\.add\('open'\)/);
  assert.match(ui, /leaveconfirmwindow_okbutton'\)\.onclick = \(\) => BonkNavigation\.menu\(\)/);
  assert.match(ui, /leaveconfirmwindow_cancelbutton'\)\.onclick = \(\) => leave\.classList\.remove\('open'\)/);
});

test('the tutorial room serves the tutorial course, never a map from a pool', async () => {
  const { server, io, rooms } = require(path.join(root, 'server.js'));
  const { io: connect } = require('socket.io-client');
  const maps = require(path.join(root, 'src/maps.js'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const socket = connect(url, { auth: { roomId: 'tutorial', name: 'Student' },
    transports: ['websocket'], reconnection: false });
  try {
    const data = await new Promise((resolve, reject) => {
      socket.on('initialData', (a, b, payload) => resolve(payload));
      socket.on('connect', () => socket.emit('getInitialData'));
      setTimeout(() => reject(new Error('no initialData')), 8000);
    });
    assert.equal(data.initialState.mm.n, 'tut4_new', 'the course, not a pick');
    // A pool map would have come from here, so make sure none of them is what we got.
    const poolNames = maps.officialPool('classic').map(entry => entry.map.m.n);
    assert.ok(!poolNames.includes(data.initialState.mm.n));
    // And the course is never frozen behind a countdown.
    assert.equal(data.initialState.ftu, -1);
  } finally {
    socket.disconnect();
    await new Promise(resolve => io.close(resolve));
    for (const id of [...rooms.keys()]) if (id.startsWith('tutorial-')) rooms.delete(id);
  }
});

test('the cursing filter replaces each word with "bonk", as the original does', () => {
  const profanity = require(path.join(root, 'client/profanity.js'));
  // The original's own list and normalisation table, lifted from the live client.
  assert.equal(profanity.WORDS.length, 94);
  assert.equal(profanity.REPLACEMENTS.length, 40);
  // It replaces the word itself -- not the message, not a row of asterisks.
  assert.equal(profanity.sanitize('you shit'), 'you bonk');
  // Several in one message, each replaced.
  assert.equal(profanity.sanitize('shit and fuck and shit'), 'bonk and bonk and bonk');
  // Case and the leetspeak table are normalised before matching.
  assert.equal(profanity.sanitize('SHIT'), 'bonk');
  assert.equal(profanity.sanitize('sh1t'), 'bonk');
  assert.equal(profanity.sanitize('$hit'), 'bonk');
  // Surrounding text is kept exactly.
  assert.equal(profanity.sanitize('well shit happens'), 'well bonk happens');
  // Clean messages are untouched, including the word it censors to.
  for (const clean of ['hello there', 'bonk', 'good game everyone', '']) {
    assert.equal(profanity.sanitize(clean), clean);
  }
  // And the old invented filter is gone: no bullet censoring, no four-word regex.
  const ui = fs.readFileSync(path.join(root, 'client/game-ui.js'), 'utf8');
  assert.doesNotMatch(ui, /•/);
  assert.doesNotMatch(ui, /fuck\|shit\|bitch\|asshole/);
  assert.match(ui, /BonkProfanity\.filtered/);
  const shell = fs.readFileSync(path.join(root, 'client/shell.js'), 'utf8');
  assert.match(shell, /BonkProfanity\.filtered/);
  for (const page of ['client/game.html', 'client/menu.html']) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /profanity\.js/);
  }
});

test('nothing is fetched from a remote host at runtime', () => {
  // Every asset the pages use is served by this project. Verified in the browser too:
  // loading the menu, the Quick Play window and a game made 69 requests, none of them
  // off-origin. This guards the source so a bonk.io URL cannot creep back in.
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(html|js|css)$/.test(entry.name)) files.push(rel);
    }
  };
  walk('client');
  assert.ok(files.length > 5, 'found the client files');
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      const url = match[0];
      // XML/RDF namespace declarations are identifiers, not things that get fetched.
      if (/w3\.org|purl\.org|creativecommons\.org|inkscape\.org|sodipodi/.test(url)) continue;
      if (/localhost|127\.0\.0\.1/.test(url)) continue;
      assert.fail(`${file} refers to a remote asset at runtime: ${url}`);
    }
  }
  // The Quick Play tiles use the original's own artwork, which is stored here. The plain
  // thumb_*.jpg files carry a black band across the bottom; the _nb ones are what the
  // original actually shows.
  const menu = fs.readFileSync(path.join(root, 'client/menu.html'), 'utf8');
  for (const mode of ['classic', 'arrows', 'grapple']) {
    assert.match(menu, new RegExp(`thumb_${mode}_nb\\.jpg`), mode);
    assert.ok(fs.existsSync(path.join(root, `resources/source/graphics/thumb_${mode}_nb.jpg`)),
      `thumb_${mode}_nb.jpg is stored locally`);
  }
  assert.doesNotMatch(menu, /thumb_(classic|arrows|grapple)\.jpg/, 'the black-banded files are not used');
});
