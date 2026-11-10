'use strict';
// The auto-hiding top bar. Shared by the game page and the menu page so the two behave
// identically rather than drifting apart.
//
// The numbers are the original's, read from its own mousemove handler on #bonkiocontainer:
// it measures the cursor against 50px from that container's top, slides the bar to top:0
// over 120ms coming in and to top:-40px over 120ms going out, with a different curve each
// way. The original drives it with anime.js, which this build does not carry, so the two
// curves are written as the cubic-beziers anime defines easeOutSine and easeInSine as.
// -40px clears the 35px bar and its border.
//
// The main menu is the one exception, and it is the owner's rule rather than something
// read out of the bundle: there the bar and the menu buttons stay up the whole time the
// mouse is on the screen, and both hide together only when it leaves, so an idle menu is
// just the replay playing behind. There is no idle timer -- it is purely whether the
// pointer is over the page.
(() => {
  const TOP_BAR = {
    threshold: 50,
    duration: 120,
    shown: '0px',
    hidden: '-40px',
    easeOutSine: 'cubic-bezier(0.39, 0.575, 0.565, 1)',
    easeInSine: 'cubic-bezier(0.47, 0, 0.745, 0.715)'
  };

  const bar = document.getElementById('pretty_top_bar');
  const area = document.getElementById('bonkiocontainer');
  if (!bar || !area) return;

  // Present only on the menu page.
  const menuContainer = document.getElementById('simpleMenuContainer');
  const menuButtons = document.getElementById('classic_mid');
  // The main menu is showing when the menu page is not in a lobby. The game page has no
  // simpleMenuContainer at all, so it is never in menu mode.
  const inMainMenu = () => Boolean(menuContainer) && !menuContainer.classList.contains('lobby');

  let shown = null;
  const setBar = show => {
    if (shown === show) return;
    shown = show;
    bar.style.transition = `top ${TOP_BAR.duration}ms ${show ? TOP_BAR.easeOutSine : TOP_BAR.easeInSine}`;
    bar.style.top = show ? TOP_BAR.shown : TOP_BAR.hidden;
  };

  let buttonsShown = null;
  const setMenuButtons = show => {
    if (!menuButtons || buttonsShown === show) return;
    buttonsShown = show;
    menuButtons.style.transition = `opacity ${TOP_BAR.duration}ms ${show ? TOP_BAR.easeOutSine : TOP_BAR.easeInSine}`;
    menuButtons.style.opacity = show ? '1' : '0';
    menuButtons.style.pointerEvents = show ? '' : 'none';
  };

  // Start out of the way. In the main menu the first pointer event puts it straight back.
  bar.style.top = TOP_BAR.hidden;
  shown = false;

  const onMove = event => {
    if (inMainMenu()) {
      // Touching the screen anywhere shows both.
      setBar(true);
      setMenuButtons(true);
      return;
    }
    setMenuButtons(true);
    const y = event.clientY - area.getBoundingClientRect().top;
    if (y < TOP_BAR.threshold) setBar(true);
    else if (y > TOP_BAR.threshold) setBar(false);
  };

  const onLeave = () => {
    setBar(false);
    if (inMainMenu()) setMenuButtons(false);
  };

  area.addEventListener('mousemove', onMove);
  area.addEventListener('mouseenter', onMove);
  // Leaving the page entirely, not just crossing between children.
  document.addEventListener('mouseleave', onLeave);
  window.addEventListener('blur', onLeave);

  // Moving between the menu and a lobby changes which rule applies, so re-evaluate.
  if (menuContainer && window.MutationObserver) {
    new MutationObserver(() => {
      if (!inMainMenu()) return;
      setMenuButtons(true);
    }).observe(menuContainer, { attributes: true, attributeFilter: ['class'] });
  }
})();
