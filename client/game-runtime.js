'use strict';

// A renderer object can outlive a disc when a player leaves or is knocked out.
const renderWithModes = BonkGraphics.prototype.render;
BonkGraphics.prototype.render = function renderActiveDiscs(state) {
  renderWithModes.call(this, state);
  this.discGraphics.forEach((graphic, id) => {
    if (graphic) graphic.container.visible = !!state.discs[id] && !state.discs[id].dead;
  });
};

if (roomId === 'tutorial') {
  // The official tutorial paints its instructions into the world, not into the page. Every
  // string, position, size and weight below was read out of the running game's scene graph
  // (see comparisons/tutorial-evidence.md); coordinates are world pixels, matching ppm 10.
  const HEAD = { fontFamily: 'futurept_medium', fontSize: 15, fill: 0xd6d6d6, dropShadow: true,
    dropShadowDistance: 2, dropShadowAlpha: 0.5, dropShadowAngle: Math.PI / 4 };
  const BODY = { fontFamily: 'futurept_medium', fontSize: 13, fill: 0xd6d6d6 };
  const TUTORIAL_TEXT = [
    { lines: [[-395.5, 10, 'TUTORIAL', HEAD]] },
    { lines: [[-670, 250, 'TO MOVE', HEAD], [-670, 272, 'arrow keys', BODY],
      [-670, 290, 'press up to jump', BODY]] },
    { lines: [[-385, 200, 'TO WIN', HEAD], [-418.5, 222, 'be the last player alive', BODY],
      [-414, 240, 'at the end of a round', BODY]] },
    { lines: [[-127, 150, 'TO SURVIVE', HEAD], [-133, 172, 'stay on the level', BODY],
      [-210, 190, "and don't touch anything black", BODY]] },
    { lines: [[15, 70, 'TO BOUNCE HIGHER', HEAD], [15, 92, 'hold UP while rising', BODY],
      [15, 110, 'hold DOWN while falling', BODY]] },
    { lines: [[395.5, 430, 'HOLD X TO MAKE YOURSELF HEAVIER', HEAD],
      [403, 452, 'always hold X before hitting another player', BODY],
      [384.5, 470, 'so you have more momentum going into a collision', BODY]] },
    { hideWhenBotDown: true,
      lines: [[750, 50, 'HOLD Z TO START DRAWING AN ARROW', HEAD],
      [750, 72, 'then use LEFT and RIGHT to aim', BODY],
      [750, 90, 'kill this bot to proceed', BODY]] },
    // Hidden until the bot is gone, as it is in the original.
    { needsBotDown: true,
      lines: [[1308, 40, 'CONTROL POINTS', HEAD],
        [1220, 62, 'stay inside the control point to capture it', BODY],
        [1157, 80, 'this will win you the round and kill all enemy players', BODY],
        [1276, 98, 'capture it to finish the tutorial', BODY]] }
  ];

  // The course is three fixed screens, divided by the map's own DIVIDERS body at world
  // x -73, 0 and 73. The camera does not follow the disc; it snaps to the screen the disc is
  // on and centres that screen's 730px in the viewport.
  const SECTION_WIDTH = 730;
  const FIRST_SECTION = -1;
  const LAST_SECTION = 1;
  // The camera eases to the new screen rather than cutting, so crossing a divider reads as a
  // slow pan rather than a jump.
  const CAMERA_EASE = 0.06;
  let cameraX = null;

  const textLayer = new PIXI.Container();
  const groups = TUTORIAL_TEXT.map(group => {
    const container = new PIXI.Container();
    for (const [x, y, content, style] of group.lines) {
      const label = new PIXI.Text(content, style);
      label.position.set(x, y);
      label.resolution = 2;
      container.addChild(label);
    }
    container.visible = !group.needsBotDown;
    textLayer.addChild(container);
    return { container, group };
  });

  const baseRender = BonkGraphics.prototype.render;
  BonkGraphics.prototype.render = function renderTutorial(state) {
    baseRender.call(this, state);
    if (textLayer.parent !== this.app.stage) this.app.stage.addChild(textLayer);
    // Keep the instructions above the map but below the discs' own labels.
    this.app.stage.setChildIndex(textLayer, Math.min(1, this.app.stage.children.length - 1));

    const disc = state.discs[0];
    if (disc) {
      const ppm = state.physics.ppm;
      const section = Math.max(FIRST_SECTION,
        Math.min(LAST_SECTION, Math.floor(disc.x * ppm / SECTION_WIDTH)));
      const view = this.app.renderer.width / this.app.renderer.resolution;
      const target = -section * SECTION_WIDTH + (view - SECTION_WIDTH) / 2;
      cameraX = cameraX === null ? target : cameraX + (target - cameraX) * CAMERA_EASE;
      if (Math.abs(target - cameraX) < 0.5) cameraX = target;
      this.app.stage.position.x = cameraX;
      this.app.stage.position.y = 0;
    }
    // The arrow instructions give way to the control point ones once the bot is down.
    const botDown = !state.discs[1] || state.discs[1].dead;
    for (const { container, group } of groups) {
      if (group.needsBotDown) container.visible = botDown;
      else if (group.hideWhenBotDown) container.visible = !botDown;
    }
  };

  let leaving = false;
  window.setInterval(() => {
    if (leaving || typeof gameStateList === 'undefined') return;
    const state = gameStateList[currentFrame];
    if (!state || !state.tutorialComplete) return;
    leaving = true;
    window.setTimeout(() => BonkNavigation.menu(), 1200);
  }, 50);
}
