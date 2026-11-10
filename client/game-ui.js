'use strict';

const gameCanvas = [...document.querySelectorAll('canvas')].find(canvas => canvas.id !== 'pretty_top_small_preview');
if (gameCanvas) document.getElementById('gameMount').appendChild(gameCanvas);

if (previewMode) {
  document.body.classList.add('preview');
  document.getElementById('prettymenu').remove();
  document.getElementById('ingamechatbox').remove();
  document.getElementById('leaveconfirmwindowcontainer').remove();
} else {
  const name = sessionStorage.getItem('bonkName') || 'New Player';
  const color = sessionStorage.getItem('bonkColor') || '#5555ff';
  document.getElementById('pretty_top_name').textContent = name;
  fetch('/health').then(response => response.json()).then(data => {
    document.getElementById('pretty_top_playercount').textContent = `${data.players} online`;
  }).catch(() => {
    document.getElementById('pretty_top_playercount').textContent = 'offline';
  });
  const preview = document.getElementById('pretty_top_small_preview').getContext('2d');
  preview.fillStyle = color;
  preview.beginPath();
  preview.arc(16.5, 16.5, 13, 0, Math.PI * 2);
  preview.fill();

  const help = document.getElementById('pretty_top_help');
  const setHelp = enabled => {
    help.classList.toggle('pretty_top_help_off', !enabled);
    help.setAttribute('aria-pressed', String(enabled));
    localStorage.setItem('bonkHelpEnabled', String(enabled));
  };
  setHelp(localStorage.getItem('bonkHelpEnabled') !== 'false');
  help.onclick = () => setHelp(help.getAttribute('aria-pressed') !== 'true');

  const volume = document.getElementById('pretty_top_volume');
  const setMuted = muted => {
    volume.classList.toggle('pretty_top_volume_off', muted);
    volume.setAttribute('aria-pressed', String(muted));
    localStorage.setItem('bonkMuted', String(muted));
  };
  setMuted(localStorage.getItem('bonkMuted') === 'true');
  volume.onclick = () => setMuted(volume.getAttribute('aria-pressed') !== 'true');

  const applySettings = settings => {
    document.getElementById('fpsCounter').style.display = settings.showFps ? 'block' : 'none';
    // Change rendering resolution, retaining the same world dimensions.
    const resolution = settings.graphics === '1' ? 1 : settings.graphics === '2' ? 1.5 : Math.max(2, devicePixelRatio);
    render.renderer.resolution = resolution;
    render.renderer.resize(730, 500);
  };
  window.addEventListener('bonk:settings-changed', () => applySettings(JSON.parse(localStorage.getItem('bonkSettings') || '{}')));
  const activeSettings = JSON.parse(localStorage.getItem('bonkSettings') || '{}');
  applySettings(activeSettings);
  let fpsFrames = 0;
  let fpsStarted = performance.now();
  const tickFps = now => {
    fpsFrames++;
    if (now - fpsStarted >= 500) {
      document.getElementById('fpsCounter').textContent = `${Math.round(fpsFrames * 1000 / (now - fpsStarted))} FPS`;
      fpsFrames = 0;
      fpsStarted = now;
    }
    requestAnimationFrame(tickFps);
  };
  requestAnimationFrame(tickFps);

  // Round, score and winner display read simulation state, so they match what rollback
  // settled on. Which of them is on screen, and what each says, follows the original's own
  // rules; comparisons/round-evidence.md says where those rules are in its code.
  const countdownBox = document.getElementById('ingamecountdown');
  const countdownText = document.getElementById('ingamecountdown_text');
  const winnerBox = document.getElementById('ingamewinner');
  const winnerName = document.getElementById('ingamewinner_top');
  const winnerResult = document.getElementById('ingamewinner_bottom');
  const winnerScoresTop = document.getElementById('ingamewinner_scores_top');
  const winnerSkin = document.getElementById('ingamewinner_skin');
  const winnerSkinInner = document.getElementById('ingamewinner_skin_skin');
  // The original shows the winner's skin inside the ring on the result overlay. Skins here
  // are a disc of the player's colour, so that is what gets drawn.
  const TEAM_COLOURS = { 2: '#ff7373', 3: '#73a9ff', 4: '#73ff87', 5: '#ffe873' };
  const drawWinnerBall = colour => {
    let ball = winnerSkinInner.querySelector('canvas');
    if (!ball) {
      ball = document.createElement('canvas');
      ball.width = 200;
      ball.height = 200;
      winnerSkinInner.replaceChildren(ball);
    }
    const ctx = ball.getContext('2d');
    ctx.clearRect(0, 0, 200, 200);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(100, 91, 78, 0, Math.PI * 2);
    ctx.fill();
  };
  const winnerScoresLeft = document.getElementById('ingamewinner_scores_left');
  const winnerScoresRight = document.getElementById('ingamewinner_scores_right');
  // The original's team names, by the team numbers it stores in a disc.
  const TEAM_NAMES = { 2: 'Red Team', 3: 'Blue Team', 4: 'Green Team', 5: 'Yellow Team' };
  const teams = () => typeof matchTeams !== 'undefined' && matchTeams;
  const winAmount = () => typeof matchWinAmount === 'undefined' ? 3 : matchWinAmount;
  const quick = () => typeof matchQuick !== 'undefined' && matchQuick;

  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };

  const tickHud = () => {
    requestAnimationFrame(tickHud);
    const state = typeof gameStateList === 'undefined' ? null : gameStateList[currentFrame];
    if (!state || state.fte === undefined) return;

    // "Round starts in N" counts a round in. The original only shows it from the second round
    // on, and never in quick play, which leaves the first round and every quick round frozen
    // with nothing on screen to say why. Here the countdown is shown whenever the world is
    // frozen, so the only time a player cannot move is a time the countdown is explaining.
    const counting = state.ftu > -1 && (typeof matchEnabled === 'undefined' || matchEnabled);
    countdownBox.classList.toggle('open', counting);
    if (counting) setText(countdownText, String(Math.ceil(state.ftu / 30)));

    // The result is on screen for the last 60 frames of the 90 the original holds it.
    const showing = state.fte > -1 && state.fte < 60;
    winnerBox.classList.toggle('open', showing);
    if (!showing) return;

    const lscr = state.lscr;
    let name = '';
    if (lscr !== -1) {
      name = teams() ? (TEAM_NAMES[lscr] || '') : (state.players[lscr]?.name || 'Unknown');
    }
    setText(winnerName, name);
    // A draw has nobody to show, so the ring and the ball come off.
    if (lscr === -1) {
      winnerSkin.style.visibility = 'hidden';
    } else {
      winnerSkin.style.visibility = 'inherit';
      drawWinnerBall(teams()
        ? (TEAM_COLOURS[lscr] || '#ffffff')
        : (state.players[lscr]?.color || '#5555ff'));
    }
    // A round with nobody left is a draw. Otherwise the original says "WINS" when that score
    // has taken the game, or in quick play where a round win is all there is, else "SCORES".
    if (lscr === -1) setText(winnerResult, 'DRAW');
    else if (state.scores[lscr] >= winAmount() || quick()) setText(winnerResult, 'WINS');
    else setText(winnerResult, 'SCORES');

    // The score table: one line per player, or per team that has a score, highest first.
    const rows = [];
    for (let id = 0; id < state.scores.length; id++) {
      if (!teams()) {
        if (state.players[id]) rows.push({ id, score: state.scores[id] });
      } else if (id >= 2 && state.scores[id] !== null && state.scores[id] !== undefined) {
        rows.push({ id, score: state.scores[id] });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    setText(winnerScoresLeft, rows.map(row =>
      `${teams() ? (TEAM_NAMES[row.id] || '') : (state.players[row.id]?.name || '')}:`).join('\r\n'));
    setText(winnerScoresRight, rows.map(row => String(row.score === undefined ? 0 : row.score)).join('\r\n'));
    setText(winnerScoresTop, `FIRST TO ${winAmount()} WINS`);
    // 999 is the original's "no limit", and it hides the line rather than printing it.
    winnerScoresTop.style.visibility = winAmount() === 999 ? 'hidden' : 'inherit';
  };
  requestAnimationFrame(tickHud);

  const leave = document.getElementById('leaveconfirmwindowcontainer');
  // What exit does depends on who you are:
  //   tutorial            leaves at once, no confirmation
  //   host of a custom game  no confirmation either -- it stops the game and puts
  //                          everyone back in the room's lobby
  //   anyone else         the original's Leave Game window
  // The window and its wording are the original's own; its geometry comes from the
  // original's pagelayout.css, which game.css no longer overrides.
  // Still to do: a host leaving the *lobby* with other players present gets
  // #hostleaveconfirmwindow, which is not built. See TODO.md.
  document.getElementById('pretty_top_exit').onclick = () => {
    if (roomId === 'tutorial') return BonkNavigation.menu();
    if (window.bonkIsHost && window.bonkHasLobby) {
      window.bonkNetworking?.socket?.emit('endGameToLobby');
      return;
    }
    leave.classList.add('open');
  };
  document.getElementById('leaveconfirmwindow_cancelbutton').onclick = () => leave.classList.remove('open');
  document.getElementById('leaveconfirmwindow_okbutton').onclick = () => BonkNavigation.menu();

  const chatBox = document.getElementById('ingamechatbox');
  const chatInput = document.getElementById('ingamechatinputtext');
  const chatContent = document.getElementById('ingamechatcontent');
  chatBox.style.visibility = 'visible';
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && document.activeElement !== chatInput) {
      event.preventDefault();
      chatInput.focus();
      chatInput.classList.add('ingamechatinputtextbg');
    } else if (event.key === 'Escape' && document.activeElement === chatInput) {
      chatInput.blur();
    }
  });
  chatInput.addEventListener('blur', () => chatInput.classList.remove('ingamechatinputtextbg'));
  chatInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    const text = chatInput.value.trim();
    if (text) networking.socket.emit('gameChat', text);
    chatInput.value = '';
    chatInput.blur();
  });
  networking.socket.on('gameChat', message => {
    const line = document.createElement('div');
    const player = document.createElement('span');
    const text = document.createElement('span');
    player.className = 'ingamechatname';
    text.className = 'ingamechatmessage';
    player.textContent = `${message.name}: `;
    text.textContent = BonkProfanity.filtered(message.text);
    line.append(player, text);
    chatContent.appendChild(line);
  });
}
