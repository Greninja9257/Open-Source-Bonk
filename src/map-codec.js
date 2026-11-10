'use strict';

// Decoder for the Bonk map format, written from the field order documented in
// resources/packets/MAPFORMAT.md. The format is an AS3 ByteArray (big-endian, UTF strings
// prefixed with an unsigned 16-bit byte length), base64 text, compressed with LZString's
// EncodedURIComponent variant.
//
// This decodes the FORMAT. It ships no official map content: the maps in this project are
// original, built in this format.

(function register(root, factory) {
  const api = factory(root.LZString || (typeof require === 'function' ? require('lz-string') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BonkMapCodec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, LZString => {

  // The live client writes version 15. Versions 14 and 15 add a body's force zone: a body
  // that stops colliding and instead pushes whatever overlaps it.
  const MAP_VERSION = 15;

  class ByteReader {
    constructor(bytes) {
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.bytes = bytes;
      this.offset = 0;
    }
    need(count) {
      if (this.offset + count > this.bytes.length) throw new Error('map data ended early');
    }
    short() { this.need(2); const value = this.view.getInt16(this.offset); this.offset += 2; return value; }
    ushort() { this.need(2); const value = this.view.getUint16(this.offset); this.offset += 2; return value; }
    int() { this.need(4); const value = this.view.getInt32(this.offset); this.offset += 4; return value; }
    uint() { this.need(4); const value = this.view.getUint32(this.offset); this.offset += 4; return value; }
    float() { this.need(4); const value = this.view.getFloat32(this.offset); this.offset += 4; return value; }
    double() { this.need(8); const value = this.view.getFloat64(this.offset); this.offset += 8; return value; }
    boolean() { this.need(1); return this.bytes[this.offset++] !== 0; }
    utf() {
      const length = this.ushort();
      this.need(length);
      const slice = this.bytes.subarray(this.offset, this.offset + length);
      this.offset += length;
      return new TextDecoder().decode(slice);
    }
    done() { return this.offset >= this.bytes.length; }
  }

  class ByteWriter {
    constructor() { this.parts = []; }
    push(size, write) {
      const buffer = new ArrayBuffer(size);
      write(new DataView(buffer));
      this.parts.push(new Uint8Array(buffer));
    }
    short(value) { this.push(2, view => view.setInt16(0, value)); }
    ushort(value) { this.push(2, view => view.setUint16(0, value)); }
    int(value) { this.push(4, view => view.setInt32(0, value)); }
    uint(value) { this.push(4, view => view.setUint32(0, value)); }
    float(value) { this.push(4, view => view.setFloat32(0, value)); }
    double(value) { this.push(8, view => view.setFloat64(0, value)); }
    boolean(value) { this.parts.push(new Uint8Array([value ? 1 : 0])); }
    utf(value) {
      const encoded = new TextEncoder().encode(String(value ?? ''));
      this.ushort(encoded.length);
      this.parts.push(encoded);
    }
    toBytes() {
      const total = this.parts.reduce((sum, part) => sum + part.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const part of this.parts) { out.set(part, at); at += part.length; }
      return out;
    }
  }

  // MAPFORMAT.md: a fixture's fr, re and de use Number.MAX_VALUE to mean "inherit".
  const INHERIT = Number.MAX_VALUE;
  const readInherit = value => (value === INHERIT ? null : value);
  const writeInherit = value => (value === null || value === undefined ? INHERIT : value);

  function blankMap() {
    return {
      v: MAP_VERSION,
      s: { re: false, nc: false, pq: 1, gd: 25, fl: false },
      physics: { shapes: [], fixtures: [], bodies: [], bro: [], joints: [], ppm: 12 },
      spawns: [],
      capZones: [],
      // vu/vd (map upvotes/downvotes) are written from version 10 onward.
      m: { a: 'noauthor', n: 'noname', dbv: 2, dbid: -1, authid: -1, date: '', rxid: 0,
        rxn: '', rxa: '', rxdb: 1, cr: [], pub: false, mo: '', vu: 0, vd: 0 }
    };
  }

  const newBoxShape = () => ({ type: 'bx', w: 10, h: 40, c: [0, 0], a: 0, sk: false });
  const newCircleShape = () => ({ type: 'ci', r: 25, c: [0, 0], sk: false });
  const newPolyShape = () => ({ type: 'po', v: [], s: 1, a: 0, c: [0, 0] });
  // ig (inner grapple) is written from version 12 onward.
  const newFixture = () => ({ n: 'Def Fix', fr: 0.3, fp: null, re: 0.8, de: 0.3, f: 5209260,
    d: false, np: false, ng: false, ig: false });
  const newBody = () => ({ type: 's', n: 'Unnamed', p: [0, 0], a: 0, fric: 0.3, fricp: false,
    re: 0.8, de: 0.3, lv: [0, 0], av: 0, ld: 0, ad: 0, fr: false, bu: false,
    cf: { x: 0, y: 0, w: true, ct: 0 }, fx: [], f_c: 1, f_p: true, f_1: true, f_2: true,
    f_3: true, f_4: true,
    // Force zone: off by default, and when on it acts on discs, other bodies and arrows.
    fz: { on: false, x: 0, y: 0, d: true, p: true, a: true, t: 0, cf: 0 } });
  const newSpawn = () => ({ x: 400, y: 300, xv: 0, yv: 0, priority: 5, r: true, f: true,
    b: true, gr: false, ye: false, n: 'Spawn' });
  const newCapZone = () => ({ n: 'Cap Zone', ty: 1, l: 10, i: -1 });

  const SHAPE_IDS = { bx: 1, ci: 2, po: 3 };
  const JOINT_IDS = { rv: 1, d: 2, lpj: 3, lsj: 4 };

  function decodeBytes(bytes) {
    const reader = new ByteReader(bytes);
    const map = blankMap();
    map.v = reader.short();
    if (map.v > MAP_VERSION) throw new Error(`map version ${map.v} is newer than ${MAP_VERSION}`);
    map.s.re = reader.boolean();
    map.s.nc = reader.boolean();
    if (map.v >= 3) map.s.pq = reader.short();
    if (map.v >= 4 && map.v <= 12) map.s.gd = reader.short();
    else if (map.v >= 13) map.s.gd = reader.float();
    if (map.v >= 9) map.s.fl = reader.boolean();
    map.m.rxn = reader.utf();
    map.m.rxa = reader.utf();
    map.m.rxid = reader.uint();
    map.m.rxdb = reader.short();
    map.m.n = reader.utf();
    map.m.a = reader.utf();
    if (map.v >= 10) { map.m.vu = reader.uint(); map.m.vd = reader.uint(); }
    if (map.v >= 4) {
      const count = reader.short();
      for (let i = 0; i < count; i++) map.m.cr.push(reader.utf());
    }
    if (map.v >= 5) { map.m.mo = reader.utf(); map.m.dbid = reader.int(); }
    if (map.v >= 7) map.m.pub = reader.boolean();
    if (map.v >= 8) map.m.dbv = reader.int();

    map.physics.ppm = reader.short();
    const broCount = reader.short();
    for (let i = 0; i < broCount; i++) map.physics.bro[i] = reader.short();

    const shapeCount = reader.short();
    for (let i = 0; i < shapeCount; i++) {
      const type = reader.short();
      if (type === SHAPE_IDS.bx) {
        const shape = newBoxShape();
        shape.w = reader.double();
        shape.h = reader.double();
        shape.c = [reader.double(), reader.double()];
        shape.a = reader.double();
        shape.sk = reader.boolean();
        map.physics.shapes[i] = shape;
      } else if (type === SHAPE_IDS.ci) {
        const shape = newCircleShape();
        shape.r = reader.double();
        shape.c = [reader.double(), reader.double()];
        shape.sk = reader.boolean();
        map.physics.shapes[i] = shape;
      } else if (type === SHAPE_IDS.po) {
        const shape = newPolyShape();
        shape.s = reader.double();
        shape.a = reader.double();
        shape.c = [reader.double(), reader.double()];
        const points = reader.short();
        shape.v = [];
        for (let point = 0; point < points; point++) shape.v.push([reader.double(), reader.double()]);
        map.physics.shapes[i] = shape;
      } else throw new Error(`unknown shape type ${type}`);
    }

    const fixtureCount = reader.short();
    for (let i = 0; i < fixtureCount; i++) {
      const fixture = newFixture();
      fixture.sh = reader.short();
      fixture.n = reader.utf();
      fixture.fr = readInherit(reader.double());
      const fp = reader.short();
      fixture.fp = fp === 0 ? null : fp === 1 ? false : true;
      fixture.re = readInherit(reader.double());
      fixture.de = readInherit(reader.double());
      fixture.f = reader.uint();
      fixture.d = reader.boolean();
      fixture.np = reader.boolean();
      if (map.v >= 11) fixture.ng = reader.boolean();
      if (map.v >= 12) fixture.ig = reader.boolean();
      map.physics.fixtures[i] = fixture;
    }

    const bodyCount = reader.short();
    for (let i = 0; i < bodyCount; i++) {
      const body = newBody();
      body.type = reader.utf();
      body.n = reader.utf();
      body.p = [reader.double(), reader.double()];
      body.a = reader.double();
      body.fric = reader.double();
      body.fricp = reader.boolean();
      body.re = reader.double();
      body.de = reader.double();
      body.lv = [reader.double(), reader.double()];
      body.av = reader.double();
      body.ld = reader.double();
      body.ad = reader.double();
      body.fr = reader.boolean();
      body.bu = reader.boolean();
      body.cf.x = reader.double();
      body.cf.y = reader.double();
      body.cf.ct = reader.double();
      body.cf.w = reader.boolean();
      body.f_c = reader.short();
      body.f_1 = reader.boolean();
      body.f_2 = reader.boolean();
      body.f_3 = reader.boolean();
      body.f_4 = reader.boolean();
      if (map.v >= 2) body.f_p = reader.boolean();
      if (map.v >= 14) {
        body.fz.on = reader.boolean();
        if (body.fz.on) {
          body.fz.x = reader.double();
          body.fz.y = reader.double();
          body.fz.d = reader.boolean();
          body.fz.p = reader.boolean();
          body.fz.a = reader.boolean();
          if (map.v >= 15) {
            body.fz.t = reader.short();
            body.fz.cf = reader.double();
          }
        }
      }
      const fixtures = reader.short();
      body.fx = [];
      for (let at = 0; at < fixtures; at++) body.fx.push(reader.short());
      map.physics.bodies[i] = body;
    }

    const spawnCount = reader.short();
    for (let i = 0; i < spawnCount; i++) {
      const spawn = newSpawn();
      spawn.x = reader.double();
      spawn.y = reader.double();
      spawn.xv = reader.double();
      spawn.yv = reader.double();
      spawn.priority = reader.short();
      spawn.r = reader.boolean();
      spawn.f = reader.boolean();
      spawn.b = reader.boolean();
      spawn.gr = reader.boolean();
      spawn.ye = reader.boolean();
      spawn.n = reader.utf();
      map.spawns[i] = spawn;
    }

    const capCount = reader.short();
    for (let i = 0; i < capCount; i++) {
      const zone = newCapZone();
      zone.n = reader.utf();
      zone.l = reader.double();
      zone.i = reader.short();
      if (map.v >= 6) zone.ty = reader.short();
      map.capZones[i] = zone;
    }

    const jointCount = reader.short();
    for (let i = 0; i < jointCount; i++) {
      const type = reader.short();
      let joint;
      if (type === JOINT_IDS.rv) {
        joint = { type: 'rv', d: { la: 0, ua: 0, mmt: 0, ms: 0, el: false, em: false, cc: false, bf: 0, dl: true }, aa: [0, 0] };
        joint.d.la = reader.double();
        joint.d.ua = reader.double();
        joint.d.mmt = reader.double();
        joint.d.ms = reader.double();
        joint.d.el = reader.boolean();
        joint.d.em = reader.boolean();
        joint.aa = [reader.double(), reader.double()];
      } else if (type === JOINT_IDS.d) {
        joint = { type: 'd', d: { fh: 0, dr: 0, cc: false, bf: 0, dl: true }, aa: [0, 0], ab: [0, 0] };
        joint.d.fh = reader.double();
        joint.d.dr = reader.double();
        joint.aa = [reader.double(), reader.double()];
        joint.ab = [reader.double(), reader.double()];
      } else if (type === JOINT_IDS.lpj) {
        joint = { type: 'lpj', d: { cc: false, bf: 0, dl: true }, pax: 0, pay: 0, pa: 0, pf: 0, pl: 0, pu: 0, plen: 0, pms: 0 };
        for (const key of ['pax', 'pay', 'pa', 'pf', 'pl', 'pu', 'plen', 'pms']) joint[key] = reader.double();
      } else if (type === JOINT_IDS.lsj) {
        joint = { type: 'lsj', d: { cc: false, bf: 0, dl: true }, sax: 0, say: 0, sf: 0, slen: 0 };
        for (const key of ['sax', 'say', 'sf', 'slen']) joint[key] = reader.double();
      } else throw new Error(`unknown joint type ${type}`);
      joint.ba = reader.short();
      joint.bb = reader.short();
      joint.d.cc = reader.boolean();
      joint.d.bf = reader.double();
      joint.d.dl = reader.boolean();
      map.physics.joints[i] = joint;
    }
    return map;
  }

  function encodeBytes(map) {
    const writer = new ByteWriter();
    const version = map.v ?? MAP_VERSION;
    writer.short(version);
    writer.boolean(map.s.re);
    writer.boolean(map.s.nc);
    if (version >= 3) writer.short(map.s.pq);
    if (version >= 4 && version <= 12) writer.short(map.s.gd);
    else if (version >= 13) writer.float(map.s.gd);
    if (version >= 9) writer.boolean(map.s.fl);
    writer.utf(map.m.rxn);
    writer.utf(map.m.rxa);
    writer.uint(map.m.rxid);
    writer.short(map.m.rxdb);
    writer.utf(map.m.n);
    writer.utf(map.m.a);
    if (version >= 10) { writer.uint(map.m.vu || 0); writer.uint(map.m.vd || 0); }
    if (version >= 4) {
      writer.short(map.m.cr.length);
      for (const name of map.m.cr) writer.utf(name);
    }
    if (version >= 5) { writer.utf(map.m.mo); writer.int(map.m.dbid); }
    if (version >= 7) writer.boolean(map.m.pub);
    if (version >= 8) writer.int(map.m.dbv);

    writer.short(map.physics.ppm);
    writer.short(map.physics.bro.length);
    for (const body of map.physics.bro) writer.short(body);

    writer.short(map.physics.shapes.length);
    for (const shape of map.physics.shapes) {
      writer.short(SHAPE_IDS[shape.type]);
      if (shape.type === 'bx') {
        writer.double(shape.w); writer.double(shape.h);
        writer.double(shape.c[0]); writer.double(shape.c[1]);
        writer.double(shape.a); writer.boolean(shape.sk);
      } else if (shape.type === 'ci') {
        writer.double(shape.r);
        writer.double(shape.c[0]); writer.double(shape.c[1]);
        writer.boolean(shape.sk);
      } else {
        writer.double(shape.s); writer.double(shape.a);
        writer.double(shape.c[0]); writer.double(shape.c[1]);
        writer.short(shape.v.length);
        for (const point of shape.v) { writer.double(point[0]); writer.double(point[1]); }
      }
    }

    writer.short(map.physics.fixtures.length);
    for (const fixture of map.physics.fixtures) {
      writer.short(fixture.sh);
      writer.utf(fixture.n);
      writer.double(writeInherit(fixture.fr));
      writer.short(fixture.fp === null || fixture.fp === undefined ? 0 : fixture.fp ? 2 : 1);
      writer.double(writeInherit(fixture.re));
      writer.double(writeInherit(fixture.de));
      writer.uint(fixture.f);
      writer.boolean(fixture.d);
      writer.boolean(fixture.np);
      if (version >= 11) writer.boolean(fixture.ng);
      if (version >= 12) writer.boolean(fixture.ig || false);
    }

    writer.short(map.physics.bodies.length);
    for (const body of map.physics.bodies) {
      writer.utf(body.type);
      writer.utf(body.n);
      writer.double(body.p[0]); writer.double(body.p[1]);
      writer.double(body.a);
      writer.double(body.fric);
      writer.boolean(body.fricp);
      writer.double(body.re);
      writer.double(body.de);
      writer.double(body.lv[0]); writer.double(body.lv[1]);
      writer.double(body.av);
      writer.double(body.ld);
      writer.double(body.ad);
      writer.boolean(body.fr);
      writer.boolean(body.bu);
      writer.double(body.cf.x); writer.double(body.cf.y); writer.double(body.cf.ct);
      writer.boolean(body.cf.w);
      writer.short(body.f_c);
      writer.boolean(body.f_1); writer.boolean(body.f_2);
      writer.boolean(body.f_3); writer.boolean(body.f_4);
      if (version >= 2) writer.boolean(body.f_p);
      if (version >= 14) {
        const zone = body.fz || { on: false };
        writer.boolean(zone.on);
        if (zone.on) {
          writer.double(zone.x);
          writer.double(zone.y);
          writer.boolean(zone.d);
          writer.boolean(zone.p);
          writer.boolean(zone.a);
          if (version >= 15) {
            writer.short(zone.t);
            writer.double(zone.cf);
          }
        }
      }
      writer.short(body.fx.length);
      for (const fixture of body.fx) writer.short(fixture);
    }

    writer.short(map.spawns.length);
    for (const spawn of map.spawns) {
      writer.double(spawn.x); writer.double(spawn.y);
      writer.double(spawn.xv); writer.double(spawn.yv);
      writer.short(spawn.priority);
      writer.boolean(spawn.r); writer.boolean(spawn.f); writer.boolean(spawn.b);
      writer.boolean(spawn.gr); writer.boolean(spawn.ye);
      writer.utf(spawn.n);
    }

    writer.short(map.capZones.length);
    for (const zone of map.capZones) {
      writer.utf(zone.n);
      writer.double(zone.l);
      writer.short(zone.i);
      if (version >= 6) writer.short(zone.ty);
    }

    writer.short(map.physics.joints.length);
    for (const joint of map.physics.joints) {
      writer.short(JOINT_IDS[joint.type]);
      if (joint.type === 'rv') {
        writer.double(joint.d.la); writer.double(joint.d.ua);
        writer.double(joint.d.mmt); writer.double(joint.d.ms);
        writer.boolean(joint.d.el); writer.boolean(joint.d.em);
        writer.double(joint.aa[0]); writer.double(joint.aa[1]);
      } else if (joint.type === 'd') {
        writer.double(joint.d.fh); writer.double(joint.d.dr);
        writer.double(joint.aa[0]); writer.double(joint.aa[1]);
        writer.double(joint.ab[0]); writer.double(joint.ab[1]);
      } else if (joint.type === 'lpj') {
        for (const key of ['pax', 'pay', 'pa', 'pf', 'pl', 'pu', 'plen', 'pms']) writer.double(joint[key]);
      } else {
        for (const key of ['sax', 'say', 'sf', 'slen']) writer.double(joint[key]);
      }
      writer.short(joint.ba);
      writer.short(joint.bb);
      writer.boolean(joint.d.cc);
      writer.double(joint.d.bf);
      writer.boolean(joint.d.dl);
    }
    return writer.toBytes();
  }

  const toBase64 = bytes => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  };
  const fromBase64 = text => {
    if (typeof atob === 'function') {
      const binary = atob(text);
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
  };

  return {
    MAP_VERSION,
    blankMap,
    decode(code) { return decodeBytes(fromBase64(LZString.decompressFromEncodedURIComponent(code))); },
    encode(map) { return LZString.compressToEncodedURIComponent(toBase64(encodeBytes(map))); },
    decodeBytes,
    encodeBytes
  };
});
