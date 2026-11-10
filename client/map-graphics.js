'use strict';

// Map drawing matched to the official client, which the supplied engine copy only approximates.
// Read out of a live game's PIXI scene graph (see comparisons/tutorial-evidence.md):
//
//  - bodies are drawn back to front in reverse `bro` order, not in array order;
//  - every body draws ALL of its shadows first (in reverse fixture order), then all of its
//    fills (in fixture order), so a shadow never lands on top of an earlier fixture's fill;
//  - a shadow is the shape filled black at alpha 0.17, offset (2, 2) in body-local space,
//    so it rotates with the body;
//  - fixtures flagged `np` are drawn but cast no shadow.

(() => {
  const SHADOW_ALPHA = 0.17;
  const SHADOW_OFFSET = 2;
  // Cap-zone rings: measured at 3px wide with ppm 10, white at 80%.
  // The green the original tints a zone with once it is fully captured.
const ZONE_TAKEN_COLOUR = 0x99ff99;
const ZONE_RING_WIDTH = 0.3;
  const ZONE_RING_ALPHA = 0.8;

  const rotate = (x, y, angle) => {
    if (!angle) return [x, y];
    const c = Math.cos(angle), s = Math.sin(angle);
    return [x * c - y * s, x * s + y * c];
  };

  BonkGraphics.prototype.renderMap = function renderMapOfficial(gst) {
    this.mapGraphics.clear();
    const ppm = gst.physics.ppm;
    const unit = ppm * this.scaleRatio;
    const bodies = gst.physics.bodies;
    const capZoneFixtures = new Set((gst.capZones || []).map(zone => zone.i));
    // A control point only opens once every rival disc is down; until then it reads as closed.
    const zoneOpen = gst.discs.filter((disc, id) => disc && id !== 0 && !disc.dead).length === 0;
    // Each zone draws its own progress, in the colour of whoever owns it.
    const zoneByFixture = new Map();
    for (const zone of gst.capZones || []) {
      const fraction = zone.l > 0 ? Math.min(1, (zone.p || 0) / zone.l) : 0;
      const owner = zone.o === undefined ? null : zone.o;
      zoneByFixture.set(zone.i, {
        fraction,
        taken: fraction >= 1,
        colour: Number.parseInt(((owner !== null && gst.players[owner]?.color)
          || gst.players[0]?.color || '#5555ff').slice(1), 16)
      });
    }
    // `bro` is front-to-back, so painting walks it backwards.
    const order = gst.physics.bro && gst.physics.bro.length
      ? [...gst.physics.bro].reverse()
      : bodies.map((body, index) => index).reverse();

    for (const bodyIndex of order) {
      const body = bodies[bodyIndex];
      if (!body) continue;
      const [bodyX, bodyY] = [body.p[0] * unit, body.p[1] * unit];

      const drawFixture = (fixtureIndex, shadow) => {
        const fixture = gst.physics.fixtures[fixtureIndex];
        if (!fixture) return;
        const shape = gst.physics.shapes[fixture.sh];
        if (!shape) return;
        if (shadow && fixture.np) return;

        const nudge = shadow ? SHADOW_OFFSET : 0;
        // A point in body-local space -> world space.
        const place = (x, y) => {
          const [rx, ry] = rotate(x + nudge, y + nudge, body.a);
          return new PIXI.Point(rx + bodyX, ry + bodyY);
        };

        // A fixture a cap zone points at is drawn as a ring, not a filled shape, and its own
        // colour is ignored: measured at 3px with ppm 10 and 80% opacity. The ring is dark
        // while the point cannot be taken yet and light once it can, and the capture itself
        // fills the ring from the centre outwards in the capturing player's colour.
        const isZone = capZoneFixtures.has(fixtureIndex);
        // The capture fills the zone from the middle outwards, and the ring is drawn over
        // the top of it rather than under it.
        const capture = isZone ? zoneByFixture.get(fixtureIndex) : null;
        if (capture && !shadow && capture.fraction > 0 && shape.type === 'ci') {
          const centre = place(shape.c[0] * unit, shape.c[1] * unit);
          this.mapGraphics.lineStyle(0);
          this.mapGraphics.beginFill(capture.colour, 0.85);
          this.mapGraphics.drawCircle(centre.x, centre.y, shape.r * unit * capture.fraction);
          this.mapGraphics.endFill();
        }
        if (isZone) {
          // A taken zone rings green, the way a captured point reads in the original.
          const ringColour = capture && capture.taken ? ZONE_TAKEN_COLOUR
            : (zoneOpen ? 0xffffff : 0x000000);
          this.mapGraphics.lineStyle(ZONE_RING_WIDTH * unit,
            shadow ? 0x000000 : ringColour,
            shadow ? SHADOW_ALPHA : ZONE_RING_ALPHA);
          this.mapGraphics.beginFill(0, 0);
        } else {
          this.mapGraphics.lineStyle(0);
          if (shadow) this.mapGraphics.beginFill(0x000000, SHADOW_ALPHA);
          else this.mapGraphics.beginFill(fixture.f);
        }

        if (shape.type === 'bx') {
          const w = shape.w / 2 * unit, h = shape.h / 2 * unit;
          const corners = [[w, -h], [w, h], [-w, h], [-w, -h]].map(([x, y]) => {
            const [rx, ry] = rotate(x, y, shape.a);
            return place(rx + shape.c[0] * unit, ry + shape.c[1] * unit);
          });
          this.mapGraphics.drawPolygon(corners);
        } else if (shape.type === 'ci') {
          const centre = place(shape.c[0] * unit, shape.c[1] * unit);
          this.mapGraphics.drawCircle(centre.x, centre.y, shape.r * unit);
        } else if (shape.type === 'po') {
          // Polygon vertices are body-local and already scaled: the official renderer applies
          // neither the editor's `a`/`c` nor its `s`, which is baked into `v` when it saves.
          this.mapGraphics.drawPolygon(shape.v.map(([x, y]) => place(x * unit, y * unit)));
        }
        this.mapGraphics.endFill();
        this.mapGraphics.lineStyle(0);

      };

      for (let i = body.fx.length - 1; i >= 0; i--) drawFixture(body.fx[i], true);
      for (let i = 0; i < body.fx.length; i++) drawFixture(body.fx[i], false);
    }
  };
})();

// Disc drawing, also matched to the official renderer: a black drop shadow at 8% offset
// (1.5, 1.5) and one radius larger than the disc, the skin colour at radius = ppm, and a
// name label in 11px futurept_book sitting two pixels below the disc.
discGraphic.prototype.render = function renderDiscOfficial(state) {
  const disc = state.discs[this.discID];
  const profile = state.players[this.discID] || {};
  const ppm = state.physics.ppm;
  // A disc can be sized, which the original does through the room's balance setting. It has
  // to be drawn at the size it actually collides at, or a bigger disc hits things its
  // picture never touches.
  const radius = (typeof disc.r === 'number' ? disc.r : 1) * ppm;
  this.container.position.x = disc.x * ppm;
  this.container.position.y = disc.y * ppm;
  this.discCircle.clear();
  this.discCircle.beginFill(0x000000, 0.08);
  this.discCircle.drawCircle(0.15 * ppm, 0.15 * ppm, radius + 1);
  this.discCircle.endFill();
  this.discCircle.beginFill(Number.parseInt((profile.color || '#5555ff').slice(1), 16));
  this.discCircle.drawCircle(0, 0, radius);
  this.discCircle.endFill();
  this.discText.style.fontFamily = 'futurept_book';
  this.discText.style.fontSize = 11;
  this.discText.text = profile.name || 'New Player';
  this.discText.anchor.set(0.5, 0);
  this.discText.position.set(0, radius + 2);
};
