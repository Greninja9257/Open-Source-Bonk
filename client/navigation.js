'use strict';
window.BonkNavigation = {
  play(room) {
    if (window.parent !== window && window.parent.BonkApp) window.parent.BonkApp.play(room);
    else { sessionStorage.setItem('bonkPendingRoom', room); location.replace('/'); }
  },
  menu() {
    if (window.parent !== window && window.parent.BonkApp) window.parent.BonkApp.menu();
    else location.replace('/');
  }
};
// Old bookmarked game URLs enter the same fixed-address application shell.
if (window.parent === window && location.pathname !== '/') {
  const room = new URLSearchParams(location.search).get('room');
  if (room) sessionStorage.setItem('bonkPendingRoom', room);
  location.replace('/');
}
