'use strict';

const $ = id => document.getElementById(id);
const roomTableBody = $('roomlisttable').tBodies[0];
let roomCache = [];
let lobbySocket = null;
let lobbyRoomId = null;
function playerName() {
  return sessionStorage.getItem('bonkName') || 'New Player';
}

function show(id) {
  $(id).classList.add('open');
}

function hide(id) {
  $(id).classList.remove('open');
}

function selectedRoom() {
  const row = roomTableBody.querySelector('tr.SELECTED');
  return row && roomCache.find(room => room.id === row.dataset.roomId);
}

function launchRoom(roomId) {
  sessionStorage.setItem('bonkName', playerName());
  BonkNavigation.play(roomId);
}

function leaveLobby() {
  lobbySocket?.disconnect();
  lobbySocket = null;
  lobbyRoomId = null;
  // The original's lobby hide() puts the start button back to "Start".
  setCountdownRunning(false);
  hide('newbonklobby');
  $('simpleMenuContainer').classList.remove('lobby');
}

// Every lobbyState used to repaint this -- each join, leave, ready tick and settings
// change -- which blanked the preview to #304356 and rebuilt it from the physics for no
// reason. The thumbnail only ever depends on the map, so the redraw is keyed on the map
// actually changing. What is drawn below is untouched.
let lobbyMapDrawnKey = null;
function drawLobbyMap(physics, key) {
  if (!physics) return;
  const mount = $('newbonklobby_mappreviewcontainer');
  let canvas = mount.querySelector('canvas');
  if (canvas && key != null && key === lobbyMapDrawnKey) return;
  lobbyMapDrawnKey = key;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'newbonklobby_mapthumb windowShadow';
    canvas.width = 117;
    canvas.height = 80;
    mount.replaceChildren(canvas);
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#304356';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  // The map is drawn in metres; the thumbnail is the 730x500 game screen shrunk to fit.
  ctx.scale(canvas.width / 730 * physics.ppm, canvas.height / 500 * physics.ppm);
  // `bro` runs front to back, so painting walks it backwards. Drawing it forwards puts a
  // map's background over the top of everything else, which on most real maps leaves the
  // preview a flat rectangle of colour.
  const order = physics.bro && physics.bro.length
    ? [...physics.bro].reverse()
    : physics.bodies.map((body, index) => index).reverse();
  for (const index of order) {
    const body = physics.bodies[index];
    if (!body) continue;
    ctx.save();
    ctx.translate(body.p[0], body.p[1]);
    ctx.rotate(body.a);
    for (const fixtureIndex of body.fx) {
      const fixture = physics.fixtures[fixtureIndex];
      const shape = fixture && physics.shapes[fixture.sh];
      if (!shape) continue;
      const colour = Number.isFinite(fixture.f) ? fixture.f : 0x8f9ba6;
      ctx.fillStyle = `#${(colour >>> 0).toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      if (shape.type === 'po') {
        // Polygon points are already scaled, turned and placed on the shape's centre, so
        // they are drawn in the body's own frame with no further transform.
        shape.v.forEach(([x, y], at) => at ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
      } else {
        ctx.save();
        ctx.translate(shape.c ? shape.c[0] : 0, shape.c ? shape.c[1] : 0);
        ctx.rotate(shape.a || 0);
        if (shape.type === 'bx') ctx.rect(-shape.w / 2, -shape.h / 2, shape.w, shape.h);
        else if (shape.type === 'ci') ctx.arc(0, 0, shape.r, 0, Math.PI * 2);
        ctx.restore();
      }
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

// The original keeps at most 250 lines in the lobby chat, dropping the oldest, and only
// follows the bottom if you were already within 5px of it -- so scrolling back to read
// does not get yanked away by new messages.
function appendChatLine(line) {
  const content = $('newbonklobby_chat_content');
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 5;
  content.appendChild(line);
  if (content.childElementCount > 250) content.removeChild(content.firstChild);
  if (atBottom) content.scrollTop = content.scrollHeight;
}

function enterLobby(roomId) {
  hide('roomListContainer');
  hide('roomlistcreatewindowcontainer');
  hide('roomlistjoinpasswordwindowcontainer');
  lobbySocket?.disconnect();
  lobbyRoomId = roomId;
  $('simpleMenuContainer').classList.add('lobby');
  show('newbonklobby');
  lobbySocket = io({ auth: { lobby: true, roomId, name: playerName(), color: sessionStorage.getItem('bonkColor') || '#5555ff' } });
  lobbySocket.on('roomError', message => {
    leaveLobby();
    $('roomliststatustext').textContent = message;
    show('roomListContainer');
  });
  lobbySocket.on('lobbyState', state => {
    const self = state.users.find(user => user.id === lobbySocket.id);
    if (self) sessionStorage.setItem('bonkLobbyTeam', String(self.team));
    lobbySpectating = !!self?.spectating;
    const container = $('newbonklobby_playerbox_leftelementcontainer');
    const otherColumn = $('newbonklobby_playerbox_rightelementcontainer');
    const spectators = $('newbonklobby_specbox_elementcontainer');
    container.replaceChildren();
    otherColumn.replaceChildren();
    spectators.replaceChildren();
    let playingIndex = 0;
    for (const user of state.users) {
      const entry = document.createElement('div');
      entry.className = 'newbonklobby_playerentry';
      const avatar = document.createElement('div');
      avatar.className = 'newbonklobby_playerentry_avatar lobby-avatar';
      // A spectator belongs to no team, so their avatar keeps their own colour.
      avatar.style.backgroundColor = state.settings.tea && user.team && !user.spectating
        ? TEAM_COLORS[user.team] : (user.color || '#5555ff');
      const name = document.createElement('div');
      name.className = 'newbonklobby_playerentry_name';
      name.textContent = user.name;
      const level = document.createElement('div');
      level.className = 'newbonklobby_playerentry_level';
      level.textContent = 'Guest';
      const isRoomHost = user.id === state.hostId;
      // The original puts two images in the row here, not text, which is where the H's
      // black outline comes from -- it is painted into the artwork, not a text stroke.
      // A ready tick is added only when the player is ready, and the host H is always
      // present: host_0.png is a blank 18x18 for everyone who is not the host.
      const host = document.createElement('img');
      host.className = 'newbonklobby_playerentry_host';
      host.src = isRoomHost ? HOST_IMAGE : '/reference/graphics/host_0.png';
      host.alt = isRoomHost ? 'Host' : '';
      let ready = null;
      if (user.ready) {
        ready = document.createElement('img');
        ready.className = 'newbonklobby_playerentry_ready';
        ready.src = '/reference/graphics/readytick.png';
        ready.alt = 'Ready';
      }
      if (state.settings.tea && user.team && !user.spectating) {
        name.title = `${TEAM_NAMES[user.team]} team`;
      }
      entry.append(avatar, name, level);
      if (ready) entry.appendChild(ready);
      entry.appendChild(host);
      if (user.spectating) spectators.appendChild(entry);
      else (playingIndex++ % 2 ? otherColumn : container).appendChild(entry);
    }
    const isHost = state.hostId === lobbySocket.id;
    lobbyIsHost = isHost;
    // The original's count for the start branch is the whole player list, spectators and
    // all, so this is state.users rather than the playing subset.
    lobbyPlayerCount = state.users.length;
    // Losing host mid-countdown leaves the old host's button reading "Abort"; the server
    // has already cancelled in that case, so put the label back.
    if (!isHost && lobbyCountingDown) setCountdownRunning(false);
    lobbyMapName = state.map?.n || '';
    lobbyMapAuthor = state.map?.a || '';
    // Team buttons replace the free-for-all Join button when teams are on.
    $('newbonklobby_teambuttonscontainer').style.display = state.settings.tea ? 'flex' : 'none';
    $('newbonklobby_ffabutton').style.display = state.settings.tea ? 'none' : 'block';
    $('newbonklobby_teamlockbutton').style.display = state.settings.tea ? 'block' : 'none';
    $('newbonklobby_teamlockbutton').classList.toggle('newbonklobby_teamlockbutton_warn', state.settings.tl);
    $('newbonklobby_teamlockbutton').title = state.settings.tl ? 'Teams locked' : 'Lock teams';
    const votes = state.votes || { up: 0, down: 0, fav: 0, mine: [] };
    $('newbonklobby_votewindow_votecount_up').textContent = votes.up;
    $('newbonklobby_votewindow_votecount_down').textContent = votes.down;
    for (const [kind, id] of [['up', 'newbonklobby_votewindow_votebutton_up'],
      ['down', 'newbonklobby_votewindow_votebutton_down'], ['fav', 'newbonklobby_votewindow_votebutton_favourite']]) {
      $(id).classList.toggle('newbonklobby_votewindow_votebutton_selected', votes.mine.includes(kind));
    }
    $('newbonklobby_votewindow_maptitle_name').textContent = lobbyMapName;
    $('newbonklobby_votewindow_maptitle_author').textContent = lobbyMapAuthor;
    renderModeMenu(state.modes || []);
    $('newbonklobby_modetext').textContent = state.settings.mode;
    $('newbonklobby_maptext').textContent = state.map?.n || '';
    $('newbonklobby_mapauthortext').textContent = state.map?.a ? `by ${state.map.a}` : '';
    // Name and author are what identify a map in the pool, so they are the redraw key.
    drawLobbyMap(state.mapPhysics, `${state.map?.n || ''}\u0000${state.map?.a || ''}`);
    const mapList = $('localLobbyMapList');
    mapList.replaceChildren();
    for (const map of state.maps || []) {
      const option = document.createElement('button');
      option.type = 'button';
      option.textContent = `${map.name} — ${map.author}`;
      // Everyone can choose here. The host sets the map; anyone else sends it as a
      // suggestion, which is the original's own split.
      option.addEventListener('click', () => {
        lobbySocket?.emit(isHost ? 'lobbyMap' : 'lobbyMapSuggest', map.index);
        hide('localLobbyMapWindow');
      });
      mapList.appendChild(option);
    }
    const rounds = $('newbonklobby_roundsinput');
    if (document.activeElement !== rounds) rounds.value = state.settings.wl;
    rounds.readOnly = !isHost;
    $('newbonklobby_teams_middletext').textContent = state.settings.tea ? 'Teams On' : 'Teams Off';
    // The original shows the start button to everyone and greys it for anyone who is not
    // the host, rather than hiding it.
    $('newbonklobby_startbutton').style.display = 'block';
    $('newbonklobby_readybutton').style.display = 'block';
    $('newbonklobby_readybutton').dataset.ready = String(!!self?.ready);
    $('newbonklobby_readybutton').textContent = self?.ready ? 'Not Ready' : 'Ready';
    // Exactly the four the original greys for a non-host, using its own class: start,
    // mode, editor and teams. The map button is deliberately NOT one of them -- anyone
    // may open the map window, and choosing there suggests a map instead of setting it.
    for (const id of ['newbonklobby_startbutton', 'newbonklobby_modebutton',
      'newbonklobby_editorbutton', 'newbonklobby_teamsbutton']) {
      $(id).classList.toggle('brownButtonDisabled', !isHost);
      $(id).classList.remove('brownButton_disabled_classic');
      $(id).setAttribute('aria-disabled', String(!isHost));
    }
    $('newbonklobby_mapbutton').classList.remove('brownButton_disabled_classic', 'brownButtonDisabled');
    $('newbonklobby_mapbutton').setAttribute('aria-disabled', 'false');
    $('newbonklobby_mapbutton').title = isHost ? 'Choose a map' : 'Suggest a map to the host';
    if (!isHost) hide('newbonklobby_mode_menu');
  });
  // Chat lines use the original's classes: a colour dot, the sender, then the message;
  // system lines such as the start countdown are a single status line.
  lobbySocket.on('lobbyChat', message => {
    const line = document.createElement('div');
    if (message.system) {
      // The original builds a status line as one span, coloured inline, with a trailing
      // space after the text. The colour is per message, which is why the captured
      // .newbonklobby_chat_status rule sets no colour of its own.
      const status = document.createElement('span');
      status.className = 'newbonklobby_chat_status';
      status.style.color = message.color || '#b53030';
      status.textContent = `${message.text} `;
      line.appendChild(status);
    } else {
      const dot = document.createElement('span');
      dot.className = 'newbonklobby_chat_msg_colorbox';
      dot.style.backgroundColor = message.color || '#5555ff';
      const name = document.createElement('span');
      name.className = 'newbonklobby_chat_msg_name';
      name.textContent = `${message.name}: `;
      const body = document.createElement('span');
      body.className = 'newbonklobby_chat_msg_txt';
      body.textContent = BonkProfanity.filtered(message.text);
      line.append(dot, name, body);
    }
    appendChatLine(line);
  });
  // A map suggestion from someone who is not the host. The original composes it from the
  // sender's name and the map's name and author, in its own two alternating classes.
  lobbySocket.on('lobbyMapSuggest', ({ name, map, author }) => {
    const line = document.createElement('div');
    const parts = [
      ['newbonklobby_chat_msg_name', `* ${name}`],
      ['newbonklobby_mapsuggest_low', ' requests '],
      ['newbonklobby_mapsuggest_high', map],
      ['newbonklobby_mapsuggest_low', ' by '],
      ['newbonklobby_mapsuggest_high', `${author} `]
    ];
    for (const [className, text] of parts) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      line.appendChild(span);
    }
    appendChatLine(line);
  });
  // The countdown can also end without this client pressing anything -- the server
  // cancels it if the host changes while it runs.
  lobbySocket.on('lobbyCountdownAborted', () => setCountdownRunning(false));
  lobbySocket.on('lobbyStart', ({ roomId: startedRoom, hostToken }) => {
    setCountdownRunning(false);
    // Only the host is given a token, and it is how the game page recognises them once
    // the lobby socket is gone.
    if (hostToken) sessionStorage.setItem('bonkHostToken', hostToken);
    else sessionStorage.removeItem('bonkHostToken');
    if (!lobbySpectating) launchRoom(startedRoom);
  });
}

let lobbyIsHost = false;
let lobbySpectating = false;
// The host's own button is the only one that ever reads "Abort": the original sets the
// label inside the start handler, which a non-host returns from before reaching it.
let lobbyCountingDown = false;
let lobbyPlayerCount = 0;
function setCountdownRunning(running) {
  lobbyCountingDown = running;
  $('newbonklobby_startbutton').textContent = running ? 'Abort' : 'Start';
}
let lobbyModes = [];
let lobbyMapName = '';
let lobbyMapAuthor = '';
// Team order follows the documented spawn flags: red, blue, green, yellow.
const TEAM_NAMES = { 1: 'Red', 2: 'Blue', 3: 'Green', 4: 'Yellow' };
const TEAM_COLORS = { 1: '#ff2b20', 2: '#2196f3', 3: '#00ee0b', 4: '#ffeb00' };
// The original's host H is tinted by the host's ping, in the same five steps as the ping
// icon beside it: `graphics/host_<type>.png`, where the type is 5 at 100ms or less, then
// 4, 3, 2 and 1 as the ping climbs past 100, 200, 300 and 400, and "tab" when they are
// tabbed out. comparisons/official-lobby-reference.png catches the real lobby at 17ms,
// which is that first band: a green H, #5ae061 on a #333333 outline, beside the 5-bar
// green ping icon. This build serves from localhost, so its latency is in that same
// band, and type 5 is the image. When ping is measured this becomes the full lookup --
// and note it is the band that decides, not the absence of data: with `ping` undefined
// none of the comparisons match and the original's own updatePings would leave the type
// at its initial 1, the red "worse than 400ms" H, which is not what the game shows.
const HOST_IMAGE = '/reference/graphics/host_5.png';
// Element ids, labels and order come from the live lobby's mode menu.
function renderModeMenu(modes) {
  if (modes.length === lobbyModes.length && modes.every((mode, index) => mode.code === lobbyModes[index]?.code)) return;
  lobbyModes = modes;
  const menu = $('newbonklobby_mode_menu');
  menu.replaceChildren();
  for (const mode of modes) {
    const button = document.createElement('div');
    button.className = 'newbonklobby_settings_button newbonklobby_settings_button_mode brownButton brownButton_classic buttonShadow';
    if (mode.id) button.id = mode.id;
    button.dataset.modeCode = mode.code;
    button.textContent = mode.name;
    if (!mode.available) {
      // Listed because the real menu lists it; disabled because this build does not implement it.
      button.classList.add('brownButton_disabled_classic');
      button.setAttribute('aria-disabled', 'true');
      button.title = `${mode.name} is not implemented in this build`;
      menu.appendChild(button);
      continue;
    }
    button.addEventListener('click', () => {
      lobbySocket?.emit('lobbySettings', { mo: mode.code });
      hide('newbonklobby_mode_menu');
    });
    menu.appendChild(button);
  }
}

function visibleModes() {
  return new Set([...document.querySelectorAll('[data-mode-filter]:checked')].map(input => input.dataset.modeFilter));
}

function applyRoomFilters() {
  const modes = visibleModes();
  const hidePassworded = $('roomlisthidepasswordedcheckbox').checked;
  roomTableBody.querySelectorAll('tr').forEach(row => {
    row.hidden = !modes.has(row.dataset.mode) || (hidePassworded && row.dataset.passworded === 'true');
  });
}

async function refreshRooms() {
  const status = $('roomliststatustext');
  roomTableBody.replaceChildren();
  status.textContent = 'Getting rooms...';
  try {
    const response = await fetch('/api/rooms');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    roomCache = await response.json();
    for (const room of roomCache) {
      const row = roomTableBody.insertRow();
      row.dataset.roomId = room.id;
      row.dataset.mode = room.mode;
      row.dataset.passworded = String(room.passworded);
      for (const value of [room.name, `${room.players} / ${room.maxPlayers}`, room.mode, room.passworded ? '🔒' : '', room.level, room.distance]) row.insertCell().textContent = value;
      row.addEventListener('click', () => {
        roomTableBody.querySelectorAll('tr').forEach(item => item.className = 'HOVERUNSELECTED');
        row.className = 'SELECTED';
      });
      row.addEventListener('dblclick', joinSelectedRoom);
    }
    roomTableBody.rows[0]?.click();
    applyRoomFilters();
    status.textContent = roomCache.length ? '' : 'No games found';
  } catch {
    status.textContent = 'Could not load games';
  }
}

function openRooms() {
  show('roomListContainer');
  refreshRooms();
}

async function joinSelectedRoom(password = '') {
  const room = selectedRoom();
  if (!room) return;
  if (room.passworded && !password) {
    show('roomlistjoinpasswordwindowcontainer');
    $('roomlistjoinpasswordtext').focus();
    return;
  }
  const response = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const result = await response.json();
  if (!response.ok) {
    $('roomlistjoinpassworderror').textContent = result.error;
    show('roomlistjoinpasswordwindowcontainer');
    return;
  }
  enterLobby(result.roomId);
}

async function createRoom() {
  const error = $('roomlistcreatewindowerror');
  error.textContent = '';
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: $('roomlistcreatewindowgamename').value,
      password: $('roomlistcreatewindowpassword').value,
      maxPlayers: Number($('roomlistcreatewindowmaxplayers').value),
      minLevel: Number($('roomlistcreatewindowminlevel').value),
      maxLevel: Number($('roomlistcreatewindowmaxlevel').value),
      unlisted: $('roomlistcreatewindowunlistedcheckbox').checked
    })
  });
  const result = await response.json();
  if (!response.ok) {
    error.textContent = result.error;
    return;
  }
  enterLobby(result.id);
}

$('classic_mid_quickplay').addEventListener('click', () => show('quickPlayWindow'));
$('quickPlayWindow_close').addEventListener('click', () => hide('quickPlayWindow'));
document.querySelectorAll('[data-quick-mode]').forEach(button => button.addEventListener('click', () => launchRoom(`quick-${button.dataset.quickMode.toLowerCase()}`)));
$('classic_mid_customgame').addEventListener('click', openRooms);
$('roomlist_close').addEventListener('click', () => hide('roomListContainer'));
$('roomlistjoinbutton').addEventListener('click', () => joinSelectedRoom());
$('roomlistrefreshbutton').addEventListener('click', refreshRooms);
$('roomlisthidepasswordedcheckbox').addEventListener('change', applyRoomFilters);
$('roomlistfilterbutton').addEventListener('click', () => $('roomlistfilterwindow').classList.toggle('open'));
$('roomlistfilterwindow_close').addEventListener('click', () => hide('roomlistfilterwindow'));
document.querySelectorAll('[data-mode-filter]').forEach(input => input.addEventListener('change', applyRoomFilters));
$('roomlistcreatebutton').addEventListener('click', () => {
  const name = $('roomlistcreatewindowgamename');
  if (!name.value.trim()) name.value = `${playerName()}'s game`.slice(0, 30);
  $('roomlistcreatewindowerror').textContent = '';
  show('roomlistcreatewindowcontainer');
});
$('roomlist_create_close').addEventListener('click', () => hide('roomlistcreatewindowcontainer'));
$('roomlistcreatecreatebutton').addEventListener('click', createRoom);
$('roomlistjoinpasswordwindowclose').addEventListener('click', () => hide('roomlistjoinpasswordwindowcontainer'));
$('roomlistpassjoinbutton').addEventListener('click', () => joinSelectedRoom($('roomlistjoinpasswordtext').value));
$('classic_mid_tutorial').addEventListener('click', () => launchRoom('tutorial'));
$('classic_mid_news').addEventListener('click', () => show('newswindow'));
$('news_close').addEventListener('click', () => hide('newswindow'));
$('classic_mid_friendlist').addEventListener('click', () => show('friendsContainer'));
$('friends_close').addEventListener('click', () => hide('friendsContainer'));
// The original's start handler, step for step: a non-host does nothing, a room of one
// starts the game at once, and otherwise the button runs a countdown and relabels itself
// to "Abort", which cancels it when pressed again.
$('newbonklobby_startbutton').addEventListener('click', () => {
  if (!lobbyIsHost) return;
  if (lobbyPlayerCount === 1) {
    lobbySocket?.emit('lobbyStart');
    return;
  }
  if (!lobbyCountingDown) {
    setCountdownRunning(true);
    lobbySocket?.emit('lobbyStart');
  } else {
    setCountdownRunning(false);
    lobbySocket?.emit('lobbyAbortCountdown');
  }
});
$('newbonklobby_modebutton').addEventListener('click', () => {
  if (!lobbyIsHost) return;
  $('newbonklobby_mode_menu').classList.toggle('open');
});
// A game the host ended sends everyone back here, into the room's lobby rather than the
// menu. game-loop.js leaves the room id behind before navigating.
const pendingLobby = sessionStorage.getItem('bonkPendingLobby');
if (pendingLobby) {
  sessionStorage.removeItem('bonkPendingLobby');
  enterLobby(pendingLobby);
}

$('newbonklobby_mapbutton').addEventListener('click', () => {
  // Anyone may open this, host or not. The original's map button does the same for
  // everybody -- the host/non-host split happens on choosing, not on opening.
  show('localLobbyMapWindow');
});
$('localLobbyMapClose').addEventListener('click', () => hide('localLobbyMapWindow'));
$('newbonklobby_teamsbutton').addEventListener('click', () => {
  if (!lobbyIsHost) return;
  lobbySocket?.emit('lobbySettings', { tea: $('newbonklobby_teams_middletext').textContent !== 'Teams On' });
});
$('newbonklobby_roundsinput').addEventListener('change', event => {
  lobbySocket?.emit('lobbySettings', { wl: Number(event.currentTarget.value) });
});
for (const [team, id] of [[1, 'newbonklobby_redbutton'], [2, 'newbonklobby_bluebutton'],
  [3, 'newbonklobby_greenbutton'], [4, 'newbonklobby_yellowbutton']]) {
  $(id).addEventListener('click', () => lobbySocket?.emit('lobbyTeam', team));
}
$('newbonklobby_ffabutton').addEventListener('click', () => { lobbySocket?.emit('lobbyParticipation', false); lobbySocket?.emit('lobbyTeam', 0); });
$('newbonklobby_specbutton').addEventListener('click', () => lobbySocket?.emit('lobbyParticipation', true));
$('newbonklobby_teamlockbutton').addEventListener('click', () => {
  if (!lobbyIsHost) return;
  lobbySocket?.emit('lobbySettings', { tl: !$('newbonklobby_teamlockbutton').classList.contains('newbonklobby_teamlockbutton_warn') });
});
$('newbonklobby_linkbutton').addEventListener('click', async () => {
  if (!lobbyRoomId) return;
  const link = `${location.origin}/game.html?room=${encodeURIComponent(lobbyRoomId)}`;
  try { await navigator.clipboard.writeText(link); } catch { /* clipboard may be blocked */ }
  $('newbonklobby_linkbutton').title = 'Room link copied';
});
// The vote window opens from the map preview, as in the original lobby.
$('newbonklobby_mappreviewcontainer').addEventListener('click', () => show('newbonklobby_votewindow_container'));
$('newbonklobby_votewindow_close').addEventListener('click', () => hide('newbonklobby_votewindow_container'));
for (const [kind, id] of [['up', 'newbonklobby_votewindow_votebutton_up'],
  ['down', 'newbonklobby_votewindow_votebutton_down'], ['fav', 'newbonklobby_votewindow_votebutton_favourite']]) {
  $(id).addEventListener('click', () => lobbySocket?.emit('lobbyVote', kind));
}
$('newbonklobby_readybutton').addEventListener('click', event => {
  const ready = event.currentTarget.dataset.ready !== 'true';
  event.currentTarget.dataset.ready = String(ready);
  event.currentTarget.textContent = ready ? 'Not Ready' : 'Ready';
  lobbySocket?.emit('lobbyReady', ready);
});
// Enter is what reaches the lobby chat, not a click. The original's own newbonklobby.css
// sets pointer-events:none on the input precisely so it cannot be clicked into, and its
// Enter handler toggles that off to focus and back on when it is done -- which is also
// why #newbonklobby_chat_lowerinstruction reads "Press enter to send a message" and is
// hidden only while you are typing. Reproduced here step for step. Removing the
// pointer-events rule instead would leave the instruction lying and the input reachable
// in a way the original never allows.
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const input = $('newbonklobby_chat_input');
  const instruction = $('newbonklobby_chat_lowerinstruction');
  if (!input || !$('newbonklobby') || $('newbonklobby').style.display === 'none') return;
  if (document.activeElement === input) {
    const text = input.value.trim();
    if (text) lobbySocket?.emit('lobbyChat', text);
    input.value = '';
    input.blur();
    if (instruction) instruction.style.visibility = 'inherit';
    input.style.pointerEvents = 'none';
  } else {
    input.focus();
    if (instruction) instruction.style.visibility = 'hidden';
    input.style.pointerEvents = 'auto';
  }
});
$('pretty_top_exit').addEventListener('click', () => {
  if (lobbySocket) {
    leaveLobby();
    return;
  }
  BonkNavigation.menu();
});
const helpButton = $('pretty_top_help');
const helpTargets = [
  [$('classic_mid_tutorial'), 'Play the interactive tutorial'],
  [$('classic_mid_quickplay'), 'Join a public match'],
  [$('classic_mid_customgame'), 'Browse or create custom games'],
  [$('classic_mid_news'), 'Read game news'],
  [$('classic_mid_skins'), 'Choose and edit your skin'],
  [$('classic_mid_friendlist'), 'View your friends']
];
function setHelpEnabled(enabled) {
  helpButton.classList.toggle('pretty_top_help_off', !enabled);
  helpButton.setAttribute('aria-pressed', String(enabled));
  helpButton.title = enabled ? 'Turn help off' : 'Turn help on';
  for (const [element, description] of helpTargets) element.title = enabled ? description : '';
  localStorage.setItem('bonkHelpEnabled', String(enabled));
}
helpButton.addEventListener('click', () => setHelpEnabled(helpButton.getAttribute('aria-pressed') !== 'true'));
setHelpEnabled(localStorage.getItem('bonkHelpEnabled') !== 'false');
$('pretty_top_volume').addEventListener('click', event => {
  const muted = event.currentTarget.dataset.muted !== 'true';
  event.currentTarget.dataset.muted = String(muted);
  event.currentTarget.classList.toggle('muted', muted);
  localStorage.setItem('bonkMuted', String(muted));
});

let selectedSkin = null;
const skinSlots = [...document.querySelectorAll('.skinmanager_iconcontainer')];
function selectSkin(slot) {
  selectedSkin = slot;
  skinSlots.forEach(item => item.classList.toggle('selected', item === slot));
}
skinSlots.forEach(slot => slot.addEventListener('click', () => selectSkin(slot)));
$('classic_mid_skins').addEventListener('click', () => {
  const activeColor = sessionStorage.getItem('bonkColor') || '#5555ff';
  selectSkin(skinSlots.find(slot => slot.dataset.skinColor === activeColor) || skinSlots[0]);
  show('skinmanager');
});
$('skinmanager_close').addEventListener('click', () => hide('skinmanager'));
$('skinmanager_setactive').addEventListener('click', () => {
  if (!selectedSkin) return;
  sessionStorage.setItem('bonkColor', selectedSkin.dataset.skinColor);
  skinSlots.forEach(slot => { slot.querySelector('.skinmanager_activetext').textContent = slot === selectedSkin ? 'Active' : ''; });
  preview.fillStyle = selectedSkin.dataset.skinColor;
  preview.clearRect(0, 0, 33, 33);
  preview.beginPath();
  preview.arc(16.5, 16.5, 13, 0, Math.PI * 2);
  preview.fill();
});
$('skinmanager_edit').addEventListener('click', () => {
  if (!selectedSkin) return;
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = selectedSkin.dataset.skinColor;
  picker.addEventListener('input', () => {
    selectedSkin.dataset.skinColor = picker.value;
    selectedSkin.querySelector('.skinmanager_icon').style.background = picker.value;
  });
  picker.click();
});

const preview = $('pretty_top_small_preview').getContext('2d');
preview.fillStyle = sessionStorage.getItem('bonkColor') || '#5555ff';
preview.beginPath();
preview.arc(16.5, 16.5, 13, 0, Math.PI * 2);
preview.fill();
$('pretty_top_name').textContent = playerName();
$('guest_nametext').value = playerName();
$('guest_colorinput').value = sessionStorage.getItem('bonkColor') || '#5555ff';
$('guestContainer').style.setProperty('--guest-color', $('guest_colorinput').value);
$('guest_colorinput').addEventListener('input', event => $('guestContainer').style.setProperty('--guest-color', event.currentTarget.value));
$('guestPlayButton').addEventListener('click', () => {
  const name = $('guest_nametext').value.trim().slice(0, 15) || 'New Player';
  const color = $('guest_colorinput').value;
  sessionStorage.setItem('bonkName', name);
  sessionStorage.setItem('bonkColor', color);
  sessionStorage.setItem('bonkGuestReady', 'true');
  $('pretty_top_name').textContent = name;
  preview.fillStyle = color;
  preview.clearRect(0, 0, 33, 33);
  preview.beginPath();
  preview.arc(16.5, 16.5, 13, 0, Math.PI * 2);
  preview.fill();
  hide('guestContainer');
  $('simpleMenuContainer').classList.remove('awaiting-guest');
});
fetch('/health').then(response => response.json()).then(data => {
  $('pretty_top_playercount').textContent = `${data.players} online`;
}).catch(() => {
  $('pretty_top_playercount').textContent = 'offline';
});

// Warm the game page while the player is still in the menu, so pressing Play or finishing a
// lobby countdown swaps to a drawn frame rather than a blank one. The warm-up copy takes no
// seat in a room; see BonkApp.preload.
(() => {
  const warm = () => { try { window.parent.BonkApp?.preload(); } catch (error) { /* standalone page */ } };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3000 });
  else window.setTimeout(warm, 1500);
})();
