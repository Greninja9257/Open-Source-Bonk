'use strict';

// Mode codes come from the server's game settings; see resources/packets/Packets.md packet 20.
const MODE_ABILITIES = {
  b: { name: 'Classic', heavy: true, special: null },
  bs: { name: 'Simple', heavy: false, special: null },
  ar: { name: 'Arrows', heavy: true, special: 'arrows' },
  ard: { name: 'Death Arrows', heavy: true, special: 'arrows', deadly: true },
  sp: { name: 'Grapple', heavy: true, special: 'grapple' }
};
// The game loop overwrites this from initialData before the first simulated frame.
var activeMode = 'b';
function modeAbilities() {
  return MODE_ABILITIES[activeMode] || MODE_ABILITIES.b;
}
// Timings still require quantitative comparison; see comparisons/mode-verification.md.
// arrowDrawTime is measured: the official bow reaches full draw after 74 frames at 30Hz.
// The original keeps one ability meter per disc, `a1a`, counted in whole units from 0 to
// 1000 and stepped once per frame. Every ability reads and writes that one meter, so these
// are its numbers rather than times in seconds:
//
//  heavy (Classic)  -10 a frame while held, +5 a frame while the key is up
//  grapple          -4 a frame while swinging, +3 a frame otherwise, and a grapple only
//                   takes hold above 500. Falling under 500 mid-swing does not just end the
//                   swing: it sets the meter to 0, so the wait before the next grapple is the
//                   climb from 0 back past 500, which is 167 frames rather than 500's worth.
//  arrows           +8 a frame, a draw needs a full 1000, and firing drops it to 500.
const METER = { full: 1000, grappleMin: 500,
  heavyDrain: 10, heavyRecharge: 5,
  grappleDrain: 4, grappleRecharge: 3,
  // A shot empties the meter, so the ring sweeps a whole circle as it reloads, and it
  // refills at twice the original's rate.
  arrowRecharge: 16, arrowFired: 0,
  // An arrows round opens with the meter half full, so nobody can fire the moment it starts.
  arrowRoundStart: 500,
  // Drawing a bow counts up in whole units too, to 100.
  drawMax: 100, drawTurnStep: 5 };
const MODE_RULES = { grappleRange: 10, arrowTurnSpeed: 5 * Math.PI / 180 * 30 };

// The bow, in disc radii, read off the official renderer in an Arrows room. The tutorial
// draws a cut-down bow with no wood, so these come from normal play; see
// comparisons/bow-evidence.md. A disc is drawn at radius = ppm, so 1 radius = 1 world unit.
const BOW = {
  // The limb is the game's own artwork: client/assets/bow-limb.svg, the wooden arc with its
  // taper and its curled tips. It is vector, so it rasterises cleanly at whatever size a
  // disc happens to be drawn.
  //
  // Where the arc sits inside that artwork, as fractions of the image, taken from the path
  // itself: the circle it follows is centred off the left edge, level with the middle, and
  // its radius is about one and a half image widths. The arc sweeps 67 degrees either side,
  // and the artwork bulges along +x, which is the aim once the sprite is turned.
  limbTexture: '/assets/bow-limb.svg',
  limbInkCentreFracX: -0.57713,
  limbInkCentreFracY: 0.50018,
  limbInkRadiusFracW: 1.48254,
  // Rasterise the vector larger than it will ever be drawn, so it stays sharp.
  limbTextureScale: 4,
  // How far the arc stands off the disc's centre, in disc radii. Measured off the real
  // game: the limb's apex sits 1.85 radii up and its tips are 3.59 radii apart.
  limbRadius: 1.87,
  // The arc is centred on the disc itself, which is where the real one sits.
  limbDrop: 0,
  // How far round the arc the limb runs, so 1.0 of this is a tip.
  limbSweep: 67 * Math.PI / 180,
  // Where the string is tied, as a fraction of that sweep: 1 is the outer edge of a tip,
  // so a little under that sits in the middle of the tip rather than on its very end.
  limbStringAt: 0.93,
  // The arrow starts at the disc's front edge and is drawn back by the square root of the
  // draw counter, which is what makes the pull quick at first and slow at the end.
  rest: 0.5,
  pullPerRoot: 0.25,
  tipForward: 0.6,
  tipSide: 1.6,
  shaftLength: 1,
  shaftWidth: 0.5,
  aimLength: 5,
  ringRadius: 1.1,
  ringWidth: 0.2
};
const basePhysicsStep = BonkPhysics.prototype.step;

BonkPhysics.prototype.step = function stepWithMode(seconds, state, inputs) {
  const next = structuredClone(state);
  next.modeState ||= { players: [], projectiles: [], grapples: [] };
  const mode = next.modeState;
  const ability = modeAbilities();
  const movement = inputs.map(input => ({ ...input }));
  // A round opens frozen for ftu frames. The ability meters do not move during it.
  //
  // For arrows that is the original exactly: its recharge is the one meter guarded by
  // `map.ftu == -1`, because an arrows round opens part-full (750, or 500 in Death
  // Arrows) and would otherwise fill itself before anyone could play. The original does
  // not guard the grapple or heavy recharges -- it does not need to, since both open
  // full and the recharge is clamped, so nothing moves either way. This build guards
  // them all, on the owner's instruction, which matches what the original shows on
  // screen. Recorded in comparisons/lobby-evidence.md.
  const frozen = (state.ftu ?? -1) > -1;
  for (let id = 0; id < next.discs.length; id++) {
    const disc = next.discs[id];
    if (!disc) continue;
    const input = inputs[id] || {};
    movement[id] ||= {};
    const player = mode.players[id] ||= {};
    // Aim and draw live on the disc, as the original keeps them: `da` is the aim in whole
    // degrees and `ds` the draw in whole units, so both survive rollback with the disc.
    if (typeof disc.da !== 'number') disc.da = 270;
    if (typeof disc.ds !== 'number') disc.ds = 0;
    // The meter lives on the disc, as it does in the original, so it survives rollback with
    // the rest of the disc's state.
    if (typeof disc.a1a !== 'number') disc.a1a = METER.full;
    // The heavy key, which the original records on the disc every frame.
    disc.a1 = !!input.action1;
    if (ability.special === 'arrows') {
      // The meter refills every frame in this mode, and the draw needs all of it.
      if (!frozen) disc.a1a = Math.min(METER.full, disc.a1a + METER.arrowRecharge);
      if (input.action2 && disc.a1a === METER.full) {
        // A draw only starts on a full meter, and then counts up a unit a frame to 100.
        disc.ds = Math.min(METER.drawMax, disc.ds + 1);
        // Turning is a whole 5 degrees a frame, and the aim wraps rather than clamping.
        if (input.left) disc.da -= METER.drawTurnStep;
        if (input.right) disc.da += METER.drawTurnStep;
        if (disc.da < 0) disc.da += 360;
        if (disc.da >= 360) disc.da -= 360;
        // Aiming takes the left and right keys; up and down still move the disc.
        for (const action of ['left','right','action1']) movement[id][action] = false;
      } else if (disc.ds !== 0) {
        // Letting go fires. The shot's speed is 15 plus the draw, and firing drops the meter
        // to half, so the next shot waits for it to climb back to full.
        const angle = disc.da * Math.PI / 180;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const speed = 15 + disc.ds;
        // Each arrow carries an id for its whole life. Drawing interpolates between the
        // last two steps, and without an id it has to match arrows by their place in the
        // list — so the moment one expires, every arrow after it appears to jump to where
        // its neighbour was. The counter lives on the state, so a rollback replays the same
        // ids.
        next.arrowSeq = (next.arrowSeq || 0) + 1;
        mode.projectiles.push({ id: next.arrowSeq, owner: id, x: disc.x + dx, y: disc.y + dy,
          xv: dx * speed, yv: dy * speed, a: angle, av: 0, age: 0 });
        disc.ds = 0;
        disc.a1a = METER.arrowFired;
      }
      player.drawing = disc.ds !== 0;
      // Heavy reads the same meter without draining it, and a drawn bow blocks it.
      disc.heavyStrength = disc.a1 && disc.ds === 0 ? disc.a1a / METER.full : 0;
    } else if (ability.special === 'grapple') {
      // The rope only lasts while the key is held.
      const wasSwinging = !!mode.grapples[id];
      if (!input.action2) mode.grapples[id] = null;
      if (mode.grapples[id]) {
        disc.a1a = Math.max(0, disc.a1a - METER.grappleDrain);
        // Under half, the rope tears off and the meter is emptied outright.
        if (disc.a1a < METER.grappleMin) { disc.a1a = 0; mode.grapples[id] = null; }
      } else {
        if (!frozen) disc.a1a = Math.min(METER.full, disc.a1a + METER.grappleRecharge);
      }
      // A fresh grapple needs the meter over half, and cannot start on a frame that was
      // already swinging.
      if (input.action2 && !wasSwinging && !mode.grapples[id] && disc.a1a > METER.grappleMin) {
        const hit = nearestGrapplePoint(next, disc, MODE_RULES.grappleRange);
        if (hit) {
          const body = next.physics.bodies[hit.bodyIndex];
          const dx = hit.x - body.p[0], dy = hit.y - body.p[1];
          mode.grapples[id] = { x: hit.x, y: hit.y, bodyIndex: hit.bodyIndex,
            localX: dx * Math.cos(body.a) + dy * Math.sin(body.a),
            localY: -dx * Math.sin(body.a) + dy * Math.cos(body.a), length: Math.max(0.1, hit.distance) };
        }
      }
      player.grappleAttempt = !!input.action2;
      // Heavy reads the same meter in this mode without draining it.
      disc.heavyStrength = disc.a1 ? disc.a1a / METER.full : 0;
    } else if (ability.heavy) {
      // Classic: the heavy drains the meter twice as fast as it refills.
      if (disc.a1) disc.a1a = Math.max(0, disc.a1a - METER.heavyDrain);
      else disc.a1a = Math.min(METER.full, disc.a1a + METER.heavyRecharge);
      disc.heavyStrength = disc.a1 ? disc.a1a / METER.full : 0;
    } else {
      // Simple has no heavy and no special.
      disc.heavyStrength = 0;
      movement[id].action1 = false;
      movement[id].action2 = false;
    }
  }
  basePhysicsStep.call(this, seconds, next, movement);
  mode.projectiles = mode.projectiles.filter(arrow => arrow.age < 5);
  if (ability.deadly) {
    for (const [owner, victim] of next.arrowHits || []) {
      if (owner === victim || !next.discs[victim]) continue;
      next.discs[victim].killedBy = owner;
    }
  }
  if (ability.special === 'grapple') {
    for (const [a,b] of next.playerContacts || []) for (const id of [a,b]) {
      if (!mode.grapples[id]) continue;
      mode.grapples[id] = null;
      // Being hit off a grapple empties the meter, same as running it down.
      next.discs[id].a1a = 0;
      next.discs[id].heavyStrength = 0;
    }
    mode.grapples.forEach(rope => {
      if (!rope) return;
      const body = next.physics.bodies[rope.bodyIndex];
      rope.x = body.p[0] + rope.localX * Math.cos(body.a) - rope.localY * Math.sin(body.a);
      rope.y = body.p[1] + rope.localX * Math.sin(body.a) + rope.localY * Math.cos(body.a);
    });
  }
  return next;
};

// One limb sprite per disc, made once and kept on the stage.
BonkGraphics.prototype.bowLimb = function bowLimb(id) {
  if (typeof PIXI === 'undefined') return null;
  this.bowLimbs = this.bowLimbs || [];
  if (!this.bowLimbs[id]) {
    const sprite = PIXI.Sprite.from(BOW.limbTexture,
      { resourceOptions: { scale: BOW.limbTextureScale } });
    // Drawn from its top left corner; the renderer works out where to put it.
    sprite.anchor.set(0, 0);
    this.app.stage.addChild(sprite);
    this.bowLimbs[id] = sprite;
  }
  return this.bowLimbs[id];
};

const baseGraphicsRender = BonkGraphics.prototype.render;
BonkGraphics.prototype.render = function renderMode(state) {
  baseGraphicsRender.call(this, state);
  if (!this.modeGraphics) { this.modeGraphics = new PIXI.Graphics(); this.app.stage.addChild(this.modeGraphics); }
  // Two layers. The original hangs a player's rope and ability meter off the bottom of that
  // player's own container, so they sit behind the disc, and puts the bow on top of it.
  // Here that is one layer kept just above the map and below every disc, and the existing
  // layer on top for the bow and the arrows.
  if (!this.underGraphics) {
    this.underGraphics = new PIXI.Graphics();
    const mapIndex = this.app.stage.getChildIndex(this.mapGraphics);
    this.app.stage.addChildAt(this.underGraphics, mapIndex + 1);
  }
  const g = this.modeGraphics;
  const under = this.underGraphics;
  g.clear();
  under.clear();
  const ability = modeAbilities();
  const ppm = state.physics.ppm;
  const ringOn = (layer,x,y,radius,fraction) => {
    const count = Math.max(1, Math.ceil(96*fraction));
    layer.moveTo(x,y-radius);
    for (let i=1;i<=count;i++) {
      const angle=-Math.PI/2+2*Math.PI*fraction*i/count;
      layer.lineTo(x+Math.cos(angle)*radius,y+Math.sin(angle)*radius);
    }
  };
  const color = id => Number.parseInt((state.players[id]?.color || '#5555ff').slice(1), 16);
  const rectangle = (x,y,angle,length,width,fill) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const points = [[-length/2,-width/2],[length/2,-width/2],[length/2,width/2],[-length/2,width/2]]
      .flatMap(([a,b]) => [(x + a*c - b*s)*ppm, (y + a*s + b*c)*ppm]);
    g.lineStyle(0); g.beginFill(fill); g.drawPolygon(points); g.endFill();
  };
  for (const arrow of state.modeState?.projectiles || []) rectangle(arrow.x,arrow.y,arrow.a,1,0.45,color(arrow.owner));
  // Every limb starts the frame hidden; a disc drawing a bow turns its own on.
  if (this.bowLimbs) for (const sprite of this.bowLimbs) if (sprite) sprite.visible = false;
  state.discs.forEach((disc,id) => {
    // A knocked-out disc keeps none of its ability furniture: no meter ring, no bow, no
    // rope. Arrows already in the air are their own bodies and fly on.
    if (!disc || disc.dead) return;
    const x = disc.x * ppm, y = disc.y * ppm;
    // Everything drawn against the disc's edge follows how big that disc actually is.
    const edge = (typeof disc.r === 'number' ? disc.r : 1) * ppm;
    const player = state.modeState?.players[id];
    // The official Heavy ring: 0.2 radii thick, drawn one radius-tenth outside the disc.
    if (disc.heavyStrength > 0) {
      under.lineStyle(0.2*ppm,0xffffff,disc.heavyStrength);
      under.drawCircle(x,y,edge*1.1);
    }
    if (!player) return;
    if (ability.special === 'arrows') {
      // The ring is the reload: the original draws the whole meter here, because a draw
      // needs all of it. White at 30%, a 2px line, one pixel outside the disc.
      const meter = typeof disc.a1a === 'number' ? disc.a1a : METER.full;
      under.lineStyle(2,0xffffff,0.3);
      ringOn(under,x,y,edge+1,meter/METER.full);
      if (state.discs[id] && state.discs[id].ds > 0) {
        // The drawn bow, in disc radii. The pull is the original's: the square root of the
        // draw counter over five, so a full draw of 100 sits the arrow two and a half radii
        // behind the disc. The string runs from the disc's top and bottom to the arrow's
        // back corners, and the wood is an arc centred on the disc whose ends meet those
        // anchors. The original draws that arc from a sprite, and leaves it out of the
        // tutorial by mistake; see comparisons/bow-evidence.md.
        const angle = state.discs[id].da * Math.PI / 180;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const point = (forward, side) =>
          [x + (dx * forward - dy * side) * edge, y + (dy * forward + dx * side) * edge];
        // Where the back of the arrow sits, in disc radii along the aim. An undrawn bow has
        // it at the disc's front edge, and pulling back moves it with the square root of
        // the draw, so it leaves quickly and then creeps: 0.5, 0.25, 0.00, -0.75, -2.00 at
        // draws of 0, 1, 4, 25, 100.
        const nock = BOW.rest - BOW.pullPerRoot * Math.sqrt(state.discs[id].ds);

        // The aim line.
        g.lineStyle(1, 0xffffff, 0.3);
        g.moveTo(x, y);
        g.lineTo(...point(BOW.aimLength, 0));

        // The wood: the original's own texture, laid so the arc it draws is centred on the
        // disc and turned to the aim.
        // The wood: the original's texture, laid so the arc it draws is centred on the disc
        // and turned to the aim.
        // Where the limb's tips are, in disc radii along and across the aim. The string is
        // tied to these, so it always meets the wood however the limb is sized or placed.
        const stringAngle = BOW.limbSweep * BOW.limbStringAt;
        const tipAlong = BOW.limbRadius * Math.cos(stringAngle) - BOW.limbDrop;
        const tipAcross = BOW.limbRadius * Math.sin(stringAngle);

        const limb = this.bowLimb(id);
        // The artwork is vector and loads a moment after the page does; until it has a real
        // size there is nothing to place, and sizing against a 1px placeholder would fling
        // it off the screen.
        if (limb && limb.texture && limb.texture.valid && limb.texture.width > 2) {
          limb.visible = true;
          limb.rotation = angle;
          // The artwork's own size decides the rest, so this works whatever resolution the
          // vector was rasterised at.
          const texW = limb.texture.width || 1;
          const texH = limb.texture.height || 1;
          const inkRadius = BOW.limbInkRadiusFracW * texW;
          const scale = BOW.limbRadius * edge / inkRadius;
          limb.scale.set(scale, scale);
          // Place the picture by hand rather than leaning on a negative anchor: work out
          // where the middle of the circle it draws sits, and shift the sprite so that point
          // lands on the disc's centre.
          const ox = BOW.limbInkCentreFracX * texW * scale;
          const oy = BOW.limbInkCentreFracY * texH * scale;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          // The arc's middle goes on the disc, then the whole limb drops back down the aim.
          const [bx, by] = point(-BOW.limbDrop, 0);
          limb.position.set(bx - (ox * cos - oy * sin), by - (ox * sin + oy * cos));
        }

        // The string: thin lines, tied to the limb's tips so they meet the wood.
        g.lineStyle(1, 0xffffff, 0.3);
        g.moveTo(...point(tipAlong, -tipAcross));
        g.lineTo(...point(nock, -BOW.shaftWidth / 2));
        g.moveTo(...point(tipAlong, tipAcross));
        g.lineTo(...point(nock, BOW.shaftWidth / 2));

        // The arrow on the string, in the player's colour.
        const scale = edge / ppm;
        rectangle(disc.x + dx * (nock + BOW.shaftLength / 2) * scale,
          disc.y + dy * (nock + BOW.shaftLength / 2) * scale,
          angle, BOW.shaftLength * scale, BOW.shaftWidth * scale, color(id));
      }
    } else if (ability.special === 'grapple') {
      const rope = state.modeState.grapples[id];
      // The original rings a disc that cannot grapple in red, and otherwise draws an arc for
      // the part of the meter that is actually usable, which is everything above half.
      const disc = state.discs[id];
      const meter = typeof disc?.a1a === 'number' ? disc.a1a : METER.full;
      if (meter < METER.grappleMin) {
        under.lineStyle(2, 0xff3333, 0.5);
        under.drawCircle(x, y, edge + 1);
      }
      const usable = (meter - METER.grappleMin) / (METER.full - METER.grappleMin);
      if (usable > 0) {
        under.lineStyle(2, 0xffffff, 0.3);
        ringOn(under, x, y, edge + 1, usable);
      }
      if (rope) {
        under.lineStyle(0.16*ppm,0xffffff,0.4);
        under.moveTo(x,y); under.lineTo(rope.x*ppm,rope.y*ppm);
        under.lineStyle(0.12*ppm,0xffffff,0.45); under.drawCircle(rope.x*ppm,rope.y*ppm,0.18*ppm);
      } else if (player.grappleAttempt && typeof networking !== 'undefined' && networking.id === id) {
        // The original's reach circle while the key is held and nothing has caught: a 2px
        // grey line at half opacity, at the grapple's own range.
        under.lineStyle(2,0xcccccc,0.5); under.drawCircle(x,y,MODE_RULES.grappleRange*ppm);
      }
    }
  });
};
