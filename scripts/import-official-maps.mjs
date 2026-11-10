// Turns the official pick pools into this project's map files.
//
// A map in Bonk's database stores its geometry in pixels, measured from the middle of the
// game screen. The simulation works in metres with the screen's top left corner at the
// origin, and the original converts between the two when it builds a game state. This project
// stores maps the way the simulation wants them, so the conversion happens here, once, at
// import time rather than on every game start.
//
// Every step below is the original's own, in its order: see comparisons/maps-evidence.md.
//
// Usage: node scripts/import-official-maps.mjs <picks-decoded.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const SCREEN_WIDTH = 730;
const SCREEN_HEIGHT = 500;

// The game does its trigonometry through SafeTrig, which is the usual function rounded to
// seven decimal places. Rounding the same way here keeps this import bit-for-bit identical
// to the conversion the real client performs.
const safe = value => Math.round(value * 1e7) / 1e7;
const safeCos = angle => safe(Math.cos(angle));
const safeSin = angle => safe(Math.sin(angle));
const safeTan = angle => safe(Math.tan(angle));
const safeAtan2 = (y, x) => safe(Math.atan2(y, x));

function rotate(x, y, angle) {
  const cos = safeCos(angle), sin = safeSin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

// The original's own pixels-to-metres pass over a decoded map.
function toSimulationUnits(map) {
  const ppm = map.physics.ppm >= 2 && map.physics.ppm <= 300 ? map.physics.ppm : 15;
  map.physics.ppm = ppm;

  for (const body of map.physics.bodies) {
    if (!body) continue;
    body.p[0] = (body.p[0] + SCREEN_WIDTH / 2) / ppm;
    body.p[1] = (body.p[1] + SCREEN_HEIGHT / 2) / ppm;
    if (body.cf) {
      // A constant force is given per second and applied per frame.
      body.cf.x /= 30;
      body.cf.y /= 30;
      body.cf.ct /= 30;
    }
    // A static body cannot carry a force or a velocity, whatever the map says. The decoder
    // keeps a body's own settings nested under `s` until they are flattened further down,
    // so the type is read from there.
    if (((body.s && body.s.type) || body.type) === 's') {
      if (body.cf) { body.cf.x = 0; body.cf.y = 0; body.cf.ct = 0; }
      body.lv = [0, 0];
      body.av = 0;
    }
  }

  for (const shape of map.physics.shapes) {
    if (!shape) continue;
    shape.c[0] /= ppm;
    shape.c[1] /= ppm;
    if (shape.type === 'bx') { shape.w /= ppm; shape.h /= ppm; }
    if (shape.type === 'ci') { shape.r /= ppm; }
    if (shape.type === 'po' || shape.type === 'ch') {
      // Vertices are scaled, rotated and moved onto the shape's centre here, so the
      // simulation and the renderer both read them ready to use.
      for (let i = 0; i < shape.v.length; i++) {
        const vx = shape.v[i][0] / ppm * shape.s;
        const vy = shape.v[i][1] / ppm * shape.s;
        const [rx, ry] = rotate(vx, vy, shape.a);
        shape.v[i] = [rx + shape.c[0], ry + shape.c[1]];
      }
      // Duplicated neighbours would make a degenerate polygon.
      for (let i = 1; i < shape.v.length; i++) {
        if (shape.v[i][0] === shape.v[i - 1][0] && shape.v[i][1] === shape.v[i - 1][1]) {
          shape.v.splice(i, 1);
          i--;
        }
      }
    }
  }

  for (const joint of map.physics.joints) {
    if (!joint || joint.type === 'g') continue;
    if (joint.d && joint.d.bf > 0) joint.d.bf /= ppm * ppm;
    if (joint.ba === -2) joint.ba = -1;
    if (joint.bb === -2) joint.bb = -1;
    const bodyA = joint.ba === -1 ? null : map.physics.bodies[joint.ba];
    const bodyB = joint.bb === -1 ? null : map.physics.bodies[joint.bb];
    const angleA = bodyA ? bodyA.a : 0;
    const angleB = bodyB ? bodyB.a : 0;

    if (joint.type === 'rv') {
      joint.aa[0] /= ppm;
      joint.aa[1] /= ppm;
      // A revolute joint stores one anchor. Both bodies' local anchors are worked out from
      // it here, because the solver wants a local anchor on each side.
      let world;
      if (!bodyA) {
        world = { x: joint.aa[0], y: joint.aa[1] };
      } else {
        world = { x: joint.aa[0] + bodyA.p[0], y: joint.aa[1] + bodyA.p[1] };
        const [ax, ay] = rotate(joint.aa[0], joint.aa[1], -angleA);
        joint.aa = [ax, ay];
      }
      if (!bodyB) {
        joint.ab = [world.x, world.y];
      } else {
        const [bx, by] = rotate(world.x - bodyB.p[0], world.y - bodyB.p[1], -angleB);
        joint.ab = [bx, by];
      }
      joint.ra = angleB - angleA;
      // The editor's angles and motor run the other way round from the solver's.
      joint.d.la = -joint.d.la;
      joint.d.ua = -joint.d.ua;
      joint.d.ms = -joint.d.ms;
      if (joint.d.la > joint.d.ua) {
        const low = joint.d.la;
        joint.d.la = joint.d.ua;
        joint.d.ua = low;
      }
    }

    if (joint.type === 'p') {
      joint.aa[0] /= ppm;
      joint.aa[1] /= ppm;
      joint.ab[0] /= ppm;
      joint.ab[1] /= ppm;
      joint.d.ut /= ppm;
      joint.d.lt /= ppm;
      joint.d.mmf = joint.d.mmf / (ppm * ppm * ppm) * 17280;
      joint.d.ms = joint.d.ms / ppm * 12;
      // The axis is stored in world terms and wanted in the body's own.
      if (bodyA) {
        const axisAngle = safeAtan2(joint.axa[1], joint.axa[0]) - angleA;
        joint.axa = [1, safeTan(axisAngle)];
      }
      joint.ra = angleB - angleA;
      joint.cs = 0;
    }

    if (joint.type === 'd') {
      joint.aa[0] /= ppm;
      joint.aa[1] /= ppm;
      joint.ab[0] /= ppm;
      joint.ab[1] /= ppm;
      // An anchor on the world rather than a body is measured from the screen's middle.
      if (!bodyB) {
        joint.ab[0] += SCREEN_WIDTH / 2 / ppm;
        joint.ab[1] += SCREEN_HEIGHT / 2 / ppm;
      }
      // The rest length is the distance between the two anchors as the map leaves them.
      const base = { x: bodyA ? bodyA.p[0] : 0, y: bodyA ? bodyA.p[1] : 0 };
      const other = { x: bodyB ? bodyB.p[0] : 0, y: bodyB ? bodyB.p[1] : 0 };
      const [aax, aay] = rotate(joint.aa[0], joint.aa[1], angleA);
      const [abx, aby] = rotate(joint.ab[0], joint.ab[1], angleB);
      const dx = (base.x + aax) - (other.x + abx);
      const dy = (base.y + aay) - (other.y + aby);
      joint.len = Math.hypot(dx, dy) || 0.01;
      // Frequency is stored as a period and wanted as a rate.
      if (joint.d.fh === 0) joint.d.fh = 1e-4;
      joint.d.fh = 1 / joint.d.fh;
    }

    // A slider's anchor is not stored: it is taken from the body it slides on.
    if (joint.type === 'lpj') {
      if (bodyA) { joint.pax = bodyA.p[0]; joint.pay = bodyA.p[1]; }
      joint.plen /= ppm;
      joint.pms /= ppm;
      joint.pf /= ppm * ppm;
    }
    if (joint.type === 'lsj') {
      if (bodyA) { joint.sax = bodyA.p[0]; joint.say = bodyA.p[1]; }
      joint.slen /= ppm;
      joint.sf /= ppm * ppm;
    }
  }

  for (const spawn of map.spawns) {
    if (!spawn) continue;
    spawn.x = (spawn.x + SCREEN_WIDTH / 2) / ppm;
    spawn.y = (spawn.y + SCREEN_HEIGHT / 2) / ppm;
    spawn.xv /= ppm;
    spawn.yv /= ppm;
    // A map with no green or yellow spawns lends them the red and blue ones.
    if (spawn.gr === undefined) spawn.gr = spawn.r;
    if (spawn.ye === undefined) spawn.ye = spawn.b;
  }
  // Green and yellow fall back to red and blue across the whole map, not per spawn.
  if (!map.spawns.some(spawn => spawn && spawn.gr)) {
    for (const spawn of map.spawns) if (spawn) spawn.gr = spawn.r;
  }
  if (!map.spawns.some(spawn => spawn && spawn.ye)) {
    for (const spawn of map.spawns) if (spawn) spawn.ye = spawn.b;
  }
  return map;
}

// The original's decoder nests a body's own settings under `s`; this project keeps them flat
// on the body, which is also how a running game state carries them.
function flattenBody(body) {
  const { s, ...rest } = body;
  return { ...rest, ...(s || {}) };
}

const decoded = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const [pool, list] of Object.entries(decoded)) {
  out[pool] = list.map(entry => {
    const map = toSimulationUnits(structuredClone(entry.map));
    map.physics.bodies = map.physics.bodies.map(body => body && flattenBody(body));
    // The map itself stays a plain map in this project's schema; where it came from is
    // recorded beside it rather than inside it.
    return {
      dbid: entry.dbid,
      sourceVersion: entry.sourceVersion,
      map: { v: map.v, s: map.s, m: map.m, physics: map.physics,
        spawns: map.spawns, capZones: map.capZones },
    };
  });
}
writeFileSync(process.argv[3], JSON.stringify(out));
const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
console.log(JSON.stringify({ imported: counts }));
