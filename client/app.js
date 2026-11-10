'use strict';
(() => {
  const frame = document.getElementById('appFrame');
  const show = src => { frame.src = src; };
  let warmFrame = null;
  window.BonkApp = {
    play(room) { show('/game.html?room=' + encodeURIComponent(room)); },
    menu() { show('/menu.html'); },
    // Fetch and compile the game page's scripts, fonts and WebGL context ahead of time, so
    // starting a match swaps straight to a drawn frame instead of a blank one. The warm-up
    // copy opens no socket and takes no seat in a room.
    preload() {
      if (warmFrame) return;
      warmFrame = document.createElement('iframe');
      warmFrame.id = 'preloadFrame';
      warmFrame.title = 'Preload';
      warmFrame.setAttribute('aria-hidden', 'true');
      warmFrame.setAttribute('tabindex', '-1');
      warmFrame.src = '/game.html?preload=1';
      document.body.appendChild(warmFrame);
    }
  };
  frame.addEventListener('load', () => frame.contentWindow.focus());
  const pending = sessionStorage.getItem('bonkPendingRoom');
  sessionStorage.removeItem('bonkPendingRoom');
  if (pending) window.BonkApp.play(pending);
  else window.BonkApp.menu();
})();
