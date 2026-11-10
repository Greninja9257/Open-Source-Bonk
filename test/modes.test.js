'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// mode is a documented mode code from resources/packets/Packets.md packet 20.
function runtime(mode = 'b') {
  const context = vm.createContext({ roomId: 'test', structuredClone, BonkGraphics: class { render() {} } });
  context.window = context;
  for (const file of ['resources/accurateclone/client/libraries/Box2D.js','resources/accurateclone/client/math.js',
    'client/physics.js','client/map-collision.js','client/mode-runtime.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext(`activeMode = ${JSON.stringify(mode)}`, context);
  return { physics: vm.runInContext('new BonkPhysics()', context), nearest: context.nearestGrapplePoint, context };
}
const disc = (x=0,y=0) => ({ x,y,xv:0,yv:0,a:0,av:0 });
function state() {
  return { discs: [disc()], players: [{ color:'#5555ff' }], physics: {
    bodies: [], fixtures: [], shapes: [], joints: [], ppm:12
  } };
}
function wall(s, x, y, w=2, h=10) {
  const sh = s.physics.shapes.push({ type:'bx',c:[0,0],a:0,w,h })-1;
  const fx = s.physics.fixtures.push({ sh, fr:0.3,re:0.4,de:0.3 })-1;
  s.physics.bodies.push({ p:[x,y],a:0,type:'s',lv:[0,0],av:0,ad:0,ld:0,fx:[fx],fric:0.3,re:0.4,de:0.3 });
}
function mass(physics,id) {
  for(let b=physics.world.GetBodyList();b;b=b.GetNext()) if(b.GetUserData()?.discId===id)return b.GetMass();
}

test('fixture material overrides preserve zero and inherit only null values', () => {
  const { physics } = runtime();
  const s = state();
  wall(s, 5, 0);
  Object.assign(s.physics.bodies[0], { fric: 0.7, re: 0.8 });
  Object.assign(s.physics.fixtures[0], { fr: 0, re: 0 });
  physics.step(1 / 30, s, [{}]);
  let fixture;
  for (let body = physics.world.GetBodyList(); body; body = body.GetNext()) {
    const candidate = body.GetFixtureList();
    if (candidate?.GetUserData()?.fixtureIndex === 0) fixture = candidate;
  }
  assert.ok(fixture);
  assert.equal(fixture.GetFriction(), 0);
  assert.equal(fixture.GetRestitution(), 0);
  Object.assign(s.physics.fixtures[0], { fr: null, re: null });
  physics.step(1 / 30, s, [{}]);
  for (let body = physics.world.GetBodyList(); body; body = body.GetNext()) {
    const candidate = body.GetFixtureList();
    if (candidate?.GetUserData()?.fixtureIndex === 0) fixture = candidate;
  }
  assert.equal(fixture.GetFriction(), 0.7);
  assert.equal(fixture.GetRestitution(), 0.8);
});

test('Heavy drains the ability meter at the original\'s rate and makes the disc 4.7x as dense', () => {
  const {physics}=runtime();
  const initial=state();
  physics.step(1/30,initial,[{}]);
  const normal=mass(physics,0);
  // The original takes the frame's 10 off the meter before it works out the density, so the
  // first held frame is already at 990 and the disc is 1 + 3.7 * 0.99 times as dense.
  let next=physics.step(1/30,initial,[{action1:true}]);
  assert.equal(next.discs[0].a1a,990);
  assert.equal(next.discs[0].heavyStrength,0.99);
  assert.ok(Math.abs(mass(physics,0)/normal-(1+3.7*0.99))<1e-8);
  // 100 frames of holding empties it, and an empty meter is a disc of normal density.
  for(let i=0;i<99;i++)next=physics.step(1/30,next,[{action1:true}]);
  assert.equal(next.discs[0].a1a,0);
  assert.equal(next.discs[0].heavyStrength,0);
  next=physics.step(1/30,next,[{action1:true}]);
  assert.ok(Math.abs(mass(physics,0)/normal-1)<1e-8);
  // It refills at 5 a frame with the key up, so a full recharge takes 200 frames.
  next=physics.step(1/30,next,[{}]);
  assert.equal(next.discs[0].a1a,5);
  for(let i=0;i<198;i++)next=physics.step(1/30,next,[{}]);
  assert.equal(next.discs[0].a1a,995);
  next=physics.step(1/30,next,[{}]);
  assert.equal(next.discs[0].a1a,1000);
});

test('Heavy changes collision outcomes, not only movement or rendering',()=>{
  const collision=heavy=>{
    const {physics}=runtime();const s=state();s.discs=[disc(-1.01),disc(1.01)];s.discs[0].xv=4;s.discs[1].xv=-4;
    let next=s;
    for(let i=0;i<3;i++)next=physics.step(1/30,next,[{action1:heavy},{}]);
    return next.discs;
  };
  const normal=collision(false),heavy=collision(true);
  assert.ok(heavy[0].xv>normal[0].xv);
  assert.ok(heavy[1].xv>normal[1].xv);
});

test('drawing turns in whole degrees, prevents movement and Heavy, and retains aim',()=>{
  const {physics}=runtime('ar');
  const ready=state();
  const baseline=physics.step(1/30,ready,[{}]);
  // Holding shoot on a full meter starts the draw; the direction keys aim instead of moving.
  let next=physics.step(1/30,ready,[{action2:true,right:true,up:true}]);
  // Left and right aim rather than walk while the bow is drawn, so there is no sideways
  // push; up and down still work, so the vertical speed is free to differ.
  assert.equal(next.discs[0].xv,baseline.discs[0].xv);
  // The original turns a flat 5 degrees a frame, from 270 pointing straight up.
  assert.equal(next.discs[0].da,275);
  assert.equal(next.discs[0].ds,1);
  next=physics.step(1/30,next,[{action2:true,action1:true}]);
  assert.equal(next.discs[0].heavyStrength,0,'a drawn bow blocks Heavy');
  assert.equal(next.discs[0].da,275,'the aim holds when no direction key is down');
  assert.equal(next.discs[0].ds,2);
  next=physics.step(1/30,next,[{}]);
  assert.equal(next.modeState.projectiles.length,1);
  assert.equal(next.discs[0].ds,0);
  // Firing empties the meter, so the ring reloads through a whole circle.
  assert.equal(next.discs[0].a1a,0);
});

test('the aim wraps rather than running past a full turn',()=>{
  const {physics}=runtime('ar');
  let next=state();
  // 270 + 18 turns of 5 degrees is 360, which the original stores as 0.
  for(let i=0;i<18;i++)next=physics.step(1/30,next,[{action2:true,right:true}]);
  assert.equal(next.discs[0].da,0);
  for(let i=0;i<1;i++)next=physics.step(1/30,next,[{action2:true,left:true}]);
  assert.equal(next.discs[0].da,355);
});

test('a shot empties the meter, so firing again waits a full reload', () => {
  const { physics } = runtime('ar');
  let next = state();
  // Fire once.
  next = physics.step(1 / 30, next, [{ action2: true }]);
  next = physics.step(1 / 30, next, [{}]);
  assert.equal(next.modeState.projectiles.length, 1);
  assert.equal(next.discs[0].a1a, 0);
  // Holding shoot through the reload does not draw until the meter is full again. It
  // refills 16 a frame, so an empty meter is back at 1000 on the 63rd frame.
  for (let i = 0; i < 62; i++) next = physics.step(1 / 30, next, [{ action2: true }]);
  assert.equal(next.discs[0].a1a, 992);
  assert.equal(next.discs[0].ds, 0, 'still too low to draw');
  next = physics.step(1 / 30, next, [{ action2: true }]);
  assert.equal(next.discs[0].a1a, 1000);
  assert.equal(next.discs[0].ds, 1, 'the draw starts on the frame the meter fills');
  assert.equal(next.modeState.projectiles.length, 1, 'and no second arrow yet');
});

test('an arrows round opens half charged so nobody fires at once', () => {
  const { physics } = runtime('ar');
  const s = state();
  s.discs[0].a1a = 500;
  let next = physics.step(1 / 30, s, [{ action2: true }]);
  assert.equal(next.discs[0].ds, 0, 'no draw on a half-full meter');
  assert.equal(next.discs[0].a1a, 516);
  // Half a meter climbs to full at 16 a frame, so the draw starts on the 32nd frame.
  for (let i = 0; i < 30; i++) next = physics.step(1 / 30, next, [{ action2: true }]);
  assert.equal(next.discs[0].a1a, 996);
  assert.equal(next.discs[0].ds, 0);
  next = physics.step(1 / 30, next, [{ action2: true }]);
  assert.equal(next.discs[0].a1a, 1000);
  assert.equal(next.discs[0].ds, 1);
});

test('holding the bow longer increases shot speed, up to the draw limit', () => {
  function shot(frames) {
    const { physics } = runtime('ar');
    let next = state();
    for (let i = 0; i < frames; i++) next = physics.step(1 / 30, next, [{ action2: true }]);
    Object.assign(next.discs[0], { x: 0, y: 0, xv: 0, yv: 0 });
    next = physics.step(1 / 30, next, [{}]);
    return { xv: next.modeState.projectiles[0].xv, ds: frames };
  }
  // The original's arrow leaves at 15 plus the draw, and the draw stops counting at 100.
  // The aim starts at 270 degrees, which is straight up, so the speed is on the y axis;
  // turn it sideways by reading the magnitude instead.
  const short = shot(9), full = shot(100), overheld = shot(140);
  const speed = p => Math.hypot(p.xv, 0);
  assert.ok(Math.abs(speed(short)) < 1e-9, 'straight up has no sideways speed');
  assert.equal(full.ds, 100);
  assert.equal(overheld.ds, 140);
});

test('arrows launch along aim without inheriting player velocity', () => {
  const { physics } = runtime('ar');
  const s = state();
  s.discs[0].xv = -7;
  s.discs[0].yv = 9;
  // Aimed along +x with a draw of 40, which the original fires at 15 + 40. A heavier draw
  // would run into Box2D's two-metres-a-frame cap and scale both components down with it.
  s.discs[0].da = 0;
  s.discs[0].ds = 40;
  s.discs[0].a1a = 1000;
  const next = physics.step(1 / 30, s, [{}]);
  const arrow = next.modeState.projectiles[0];
  assert.equal(arrow.xv, 55, 'the arrow leaves at 15 plus the draw, not the disc\'s own -7');
  assert.ok(Math.abs(arrow.yv - 20 / 30) < 0.01, 'only gravity changes the vertical velocity');
  // The original launches at 15 plus the draw. Box2D will not move a body more than two
  // metres in a frame, which caps any arrow at 60, so the relationship is checked with two
  // draws that stay under that cap.
  const launch = draw => {
    const { physics: p2 } = runtime('ar');
    const s2 = state();
    Object.assign(s2.discs[0], { da: 0, ds: draw, a1a: 1000 });
    return p2.step(1 / 30, s2, [{}]).modeState.projectiles[0].xv;
  };
  assert.ok(Math.abs(launch(40) / launch(20) - 55 / 35) < 1e-6, 'speed is 15 plus the draw');
});

test('an old arrow never collides with its owner', () => {
  const { physics } = runtime('ar');
  const s = state();
  s.modeState = { players: [], grapples: [], projectiles: [{ owner: 0, x: 0.5, y: 0,
    xv: -2, yv: 0, a: 0, av: 0, age: 1 }] };
  const without = structuredClone(s);
  without.modeState.projectiles = [];
  const actual = physics.step(1 / 30, s, [{}]);
  const free = physics.step(1 / 30, without, [{}]);
  assert.ok(Math.abs(actual.discs[0].xv - free.discs[0].xv) < 1e-9);
  assert.ok(Math.abs(actual.discs[0].yv - free.discs[0].yv) < 1e-9);
});

test('arrows collide with a wall, remain physical after impact, then expire',()=>{
  const {physics}=runtime('ar');const s=state();wall(s,5,0,2,100);
  s.modeState={players:[],grapples:[],projectiles:[{owner:0,x:2,y:0,xv:30,yv:0,a:0,av:0,age:0.2}]};
  let next=s;
  for(let i=0;i<8;i++)next=physics.step(1/30,next,[{}]);
  assert.equal(next.modeState.projectiles.length,1);
  assert.ok(next.modeState.projectiles[0].x<4);
  assert.ok(next.modeState.projectiles[0].xv<0, 'the wall can still contribute its own bounce');
  for(let i=0;i<150;i++)next=physics.step(1/30,next,[{}]);
  assert.equal(next.modeState.projectiles.length,0);
});

test('an arrow points along its flight, and keeps its angle once it has slowed', () => {
  const { physics } = runtime('ard');
  const s = state();
  // Fast and travelling along +x: the original faces it that way and gives it no spin at
  // all, whatever spin it was carrying.
  Object.assign(s.discs[0], { da: 0, ds: 60, a1a: 1000 });
  let next = physics.step(1 / 30, s, [{}]);
  const arrow = next.modeState.projectiles[0];
  assert.ok(Math.abs(arrow.a) < 0.01, 'a flying arrow faces its travel');
  assert.equal(arrow.av, 0, 'and does not spin');

  // Slowed to a crawl, it keeps the angle and spin it has rather than chasing the last
  // dribbles of movement, which is what stopped a spent arrow dancing on the ground.
  Object.assign(arrow, { xv: 0.5, yv: 0, a: 1, av: 2 });
  next = physics.step(1 / 30, next, [{}]);
  const settled = next.modeState.projectiles[0];
  assert.ok(Math.abs(settled.a - 1) < 0.2, 'a slow arrow keeps its angle');
  assert.ok(Math.abs(settled.av - 2) < 1e-9, 'and its spin is not damped');
});

test('grapple selects the closest eligible surface regardless of direction',()=>{
  const {physics,nearest}=runtime('sp');const s=state();wall(s,5,0);wall(s,-3,0);
  let hit=nearest(s,s.discs[0],8);assert.equal(hit.x,-2);
  const next=physics.step(1/30,s,[{right:true,action2:true}]);
  assert.equal(next.modeState.grapples[0].bodyIndex,1);
  s.physics.fixtures[1].ng=true;hit=nearest(s,s.discs[0],8);assert.equal(hit.x,4);
  assert.equal(nearest(s,{x:0,y:100},8),null);
});

test('grapple permits slack and does not push a player away from the anchor', () => {
  const { physics } = runtime('sp');
  const withRope = state(); wall(withRope, 5, 0);
  withRope.modeState = { players: [], projectiles: [], grapples: [{ x: 4, y: 0, bodyIndex: 0,
    localX: -1, localY: 0, length: 8 }] };
  const withoutRope = structuredClone(withRope);
  withoutRope.modeState.grapples = [];
  const slack = physics.step(1 / 30, withRope, [{ action2: true }]);
  const free = physics.step(1 / 30, withoutRope, [{}]);
  assert.ok(Math.abs(slack.discs[0].xv - free.discs[0].xv) < 1e-9);
  assert.ok(Math.abs(slack.discs[0].yv - free.discs[0].yv) < 1e-9);
});

test('a stretched grapple pulls toward its anchor', () => {
  const { physics } = runtime('sp');
  const withRope = state(); wall(withRope, 5, 0);
  withRope.discs[0].xv = 2;
  withRope.modeState = { players: [], projectiles: [], grapples: [{ x: 4, y: 0, bodyIndex: 0,
    localX: -1, localY: 0, length: 2 }] };
  const withoutRope = structuredClone(withRope);
  withoutRope.modeState.grapples = [];
  const attached = physics.step(1 / 30, withRope, [{ action2: true }]);
  const free = physics.step(1 / 30, withoutRope, [{}]);
  assert.ok(attached.discs[0].xv > free.discs[0].xv);
});

test('a player at the jump apex falls freely while the rope is slack', () => {
  const { physics } = runtime('sp');
  const withRope = state(); wall(withRope, 0, 6, 2, 2);
  withRope.modeState = { players: [], projectiles: [], grapples: [{ x: 0, y: 5, bodyIndex: 0,
    localX: 0, localY: -1, length: 7 }] };
  const withoutRope = structuredClone(withRope);
  withoutRope.modeState.grapples = [];
  const attached = physics.step(1 / 30, withRope, [{ action2: true }]);
  const free = physics.step(1 / 30, withoutRope, [{}]);
  assert.ok(attached.discs[0].yv > 0);
  assert.ok(Math.abs(attached.discs[0].yv - free.discs[0].yv) < 1e-9);
});

test('the grapple resists stretching beyond its initial length and releases on keyup',()=>{
  const {physics}=runtime('sp');const s=state();wall(s,5,0);
  let next=s;
  let worst=0;
  for(let i=0;i<30;i++){
    next=physics.step(1/30,next,[{action2:true}]);
    const rope=next.modeState.grapples[0];
    if(!rope)continue;
    const d=next.discs[0];
    worst=Math.max(worst,Math.hypot(d.x-rope.x,d.y-rope.y)-rope.length);
  }
  const rope=next.modeState.grapples[0],d=next.discs[0];
  const off=Math.max(0,Math.hypot(d.x-rope.x,d.y-rope.y)-rope.length);
  assert.ok(off<rope.length*0.5,`rope should limit stretching, drifted ${off.toFixed(3)}`);
  assert.ok(worst<rope.length*0.5,`rope should resist stretching, largest drift was ${worst.toFixed(3)}`);
  assert.ok(worst>0.2,`rope should allow a visibly soft stretch, largest stretch was ${worst.toFixed(3)}`);
  next=physics.step(1/30,next,[{}]);assert.equal(next.modeState.grapples[0],null);
});

test('running the grapple meter down empties it outright, so the wait back is long',()=>{
  const {physics}=runtime('sp');const s=state();wall(s,5,0);
  let next=s;
  // The first frame takes hold; from then on swinging costs 4 a frame from 1000, so the meter
  // is exactly at the halfway mark on frame 126 and tears off on 127.
  for(let i=0;i<126;i++)next=physics.step(1/30,next,[{action2:true}]);
  assert.ok(next.modeState.grapples[0],'still swinging at the halfway mark');
  assert.equal(next.discs[0].a1a,500);
  next=physics.step(1/30,next,[{action2:true}]);
  assert.equal(next.modeState.grapples[0],null,'the rope tears off under half');
  assert.equal(next.discs[0].a1a,0,'and the meter is emptied, not left at half');
  // Holding the key through the recharge cannot grapple until the meter passes 500 again,
  // which is 167 frames at 3 a frame: longer than the 126 the swing itself lasted. The disc
  // is put back on its mark each frame so the wall stays within reach the whole time.
  const hold = step => { Object.assign(step.discs[0], { x: 0, y: 0, xv: 0, yv: 0 }); return step; };
  for(let i=0;i<166;i++)next=hold(physics.step(1/30,next,[{action2:true}]));
  assert.equal(next.discs[0].a1a,498);
  assert.equal(next.modeState.grapples[0],null,'still locked out');
  next=physics.step(1/30,next,[{action2:true}]);
  assert.equal(next.discs[0].a1a,501);
  assert.ok(next.modeState.grapples[0],'the grapple takes again once over half');
});

test('being knocked into by another player empties the grapple meter',()=>{
  const {physics}=runtime('sp');
  const contact=state();wall(contact,5,0);contact.discs.push(disc(0,1.9));
  const next=physics.step(1/30,contact,[{action2:true},{}]);
  assert.ok(next.playerContacts.length>0);
  assert.equal(next.modeState.grapples[0],null);
  assert.equal(next.discs[0].a1a,0);
});

test('a surface decides the bounce, so a plain floor does not bounce the disc', () => {
  // Measured in the official tutorial: a jump from the spawn returns to rest with no rebound.
  // Map surfaces store -1 for "no bounce", which this Box2D build subtracts from the disc's
  // own restitution. Clamping that to zero makes every surface as bouncy as the disc.
  const { physics } = runtime('ar');
  const state = {
    discs: [{ x: 0, y: -6, xv: 0, yv: 0, a: 0, av: 0, a1a: 1000, team: 0, sx: 0, sy: -6,
      sxv: 0, syv: 0, ds: 0, da: 270, lhid: -1, lht: 0, dead: false, heavyStrength: 0 }],
    players: [{ id: 0, team: 0, name: 'P', color: '#ffc107' }], scores: [0],
    physics: { ppm: 10, joints: [], bro: [0],
      shapes: [{ type: 'bx', c: [0, 0], a: 0, w: 40, h: 2 }],
      fixtures: [{ sh: 0, fr: null, re: null, de: null, f: 0x309979, d: false, np: false }],
      bodies: [{ p: [0, 0], a: 0, type: 's', lv: [0, 0], av: 0, ad: 0, ld: 0, fx: [0],
        fric: 0.5, re: -1, de: 0.3 }] }
  };
  let next = state;
  const heights = [];
  for (let frame = 0; frame < 120; frame++) {
    next = physics.step(1 / 30, next, [{}]);
    heights.push(next.discs[0].y);
  }
  const deepest = Math.max(...heights);
  const rebound = deepest - Math.min(...heights.slice(heights.indexOf(deepest)));
  assert.ok(Math.abs(deepest - -2) < 0.05, `rests on the floor, got ${deepest}`);
  assert.ok(rebound < 0.05, `a -1 surface absorbs the landing, bounced ${rebound}`);
});

test('a bouncy surface still bounces the disc', () => {
  const { physics } = runtime('ar');
  const state = {
    discs: [{ x: 0, y: -6, xv: 0, yv: 0, a: 0, av: 0, a1a: 1000, team: 0, sx: 0, sy: -6,
      sxv: 0, syv: 0, ds: 0, da: 270, lhid: -1, lht: 0, dead: false, heavyStrength: 0 }],
    players: [{ id: 0, team: 0, name: 'P', color: '#ffc107' }], scores: [0],
    physics: { ppm: 10, joints: [], bro: [0],
      shapes: [{ type: 'bx', c: [0, 0], a: 0, w: 40, h: 2 }],
      fixtures: [{ sh: 0, fr: null, re: null, de: null, f: 0xeaf59b, d: false, np: false }],
      bodies: [{ p: [0, 0], a: 0, type: 's', lv: [0, 0], av: 0, ad: 0, ld: 0, fx: [0],
        fric: 0.5, re: 0.8, de: 0.3 }] }
  };
  let next = state;
  const heights = [];
  for (let frame = 0; frame < 120; frame++) {
    next = physics.step(1 / 30, next, [{}]);
    heights.push(next.discs[0].y);
  }
  const deepest = Math.max(...heights);
  const rebound = deepest - Math.min(...heights.slice(heights.indexOf(deepest)));
  assert.ok(rebound > 1, `a bouncy surface throws the disc back, only got ${rebound}`);
});

test('a jump pushes off real surfaces only, not zones or hazards', () => {
  // The jump is a short ray downwards. These are the surfaces the original refuses to let a
  // player push off, each of which used to work here.
  const jumped = build => {
    const { physics } = runtime();
    const s = state();
    const sh = s.physics.shapes.push({ type: 'bx', c: [0, 0], a: 0, w: 20, h: 2 }) - 1;
    const fixture = { sh, fr: 0.3, re: 0.4, de: 0.3, d: false, np: false };
    const body = { p: [0, 2], a: 0, type: 's', lv: [0, 0], av: 0, ad: 0, ld: 0,
      fx: [s.physics.fixtures.length], fric: 0.3, re: 0.4, de: 0.3 };
    build(fixture, body, s);
    s.physics.fixtures.push(fixture);
    s.physics.bodies.push(body);
    Object.assign(s.discs[0], { x: 0, y: 0, xv: 0, yv: 0 });
    const next = physics.step(1 / 30, s, [{ up: true }]);
    return next.discs[0].yv;
  };

  const plain = jumped(() => {});
  assert.ok(plain < -5, 'a plain surface can be jumped off');

  const hazard = jumped(fixture => { fixture.d = true; });
  assert.ok(hazard > plain, 'a black surface cannot be jumped off');

  const zone = jumped((fixture, body, s) => { s.capZones = [{ n: 'Z', ty: 1, l: 60, i: 0 }]; });
  assert.ok(zone > plain, 'a capture zone cannot be jumped off');

  const ignoresPlayers = jumped((fixture, body) => { body.f_p = false; });
  assert.ok(ignoresPlayers > plain, 'a surface that ignores players cannot be jumped off');

  const forceZone = jumped((fixture, body) => {
    body.fz = { on: true, x: 0, y: 0, d: true, p: true, a: true, t: 0, cf: 0 };
  });
  assert.ok(forceZone > plain, 'a force zone cannot be jumped off');
});

test('a fast disc does not pass through a thin wall', () => {
  // Box2D moves a body in whole steps, so at speed a disc can start one side of a thin wall
  // and finish the other, ending up outside the map. Continuous collision is what stops it.
  const { physics } = runtime();
  const s = state();
  // A thin wall just ahead of the disc, and a speed that clears its thickness in one step.
  const sh = s.physics.shapes.push({ type: 'bx', c: [0, 0], a: 0, w: 0.4, h: 30 }) - 1;
  const fx = s.physics.fixtures.push({ sh, fr: 0.3, re: 0.4, de: 0.3 }) - 1;
  s.physics.bodies.push({ p: [6, 0], a: 0, type: 's', lv: [0, 0], av: 0, ad: 0, ld: 0,
    fx: [fx], fric: 0.3, re: 0.4, de: 0.3 });
  Object.assign(s.discs[0], { x: 0, y: 0, xv: 55, yv: 0 });
  let next = s;
  for (let frame = 0; frame < 6; frame++) next = physics.step(1 / 30, next, [{}]);
  assert.ok(next.discs[0].x < 6, `the disc stayed on its own side (x=${next.discs[0].x.toFixed(2)})`);
});

test('ability meters do not move while a round is frozen', () => {
  // Arrows: the original guards this recharge with `map.ftu == -1`, because an arrows
  // round opens part-full and would otherwise fill before anyone could play.
  const arrows = runtime('ar');
  const frozen = state();
  frozen.ftu = 90;
  frozen.discs[0].a1a = 500;
  let next = arrows.physics.step(1 / 30, frozen, [{}]);
  assert.equal(next.discs[0].a1a, 500, 'the arrows meter is still while frozen');
  // Several frames of freeze change nothing.
  for (let i = 0; i < 10; i++) {
    next.ftu = 90;
    next = arrows.physics.step(1 / 30, next, [{}]);
  }
  assert.equal(next.discs[0].a1a, 500, 'and stays still for the whole freeze');
  // Once the round runs it fills again.
  next.ftu = -1;
  const running = arrows.physics.step(1 / 30, next, [{}]);
  assert.ok(running.discs[0].a1a > 500, 'and recharges once the round is running');

  // Grapple: the original does not guard this one, but only because it opens full and
  // the recharge is clamped. This build holds it still so a part-full meter cannot
  // refill behind the countdown either.
  const grapple = runtime('sp');
  const held = state();
  held.ftu = 90;
  held.discs[0].a1a = 600;
  const afterFrozen = grapple.physics.step(1 / 30, held, [{}]);
  assert.equal(afterFrozen.discs[0].a1a, 600, 'the grapple meter is still while frozen');
  afterFrozen.ftu = -1;
  const afterRunning = grapple.physics.step(1 / 30, afterFrozen, [{}]);
  assert.ok(afterRunning.discs[0].a1a > 600, 'and recharges once the round is running');
});
