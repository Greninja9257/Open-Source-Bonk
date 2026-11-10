// Adapted from the supplied resources/accurateclone/client/physics.js.
// Keep application changes here so the reference resource remains intact.
const b2Vec2 = Box2D.Common.Math.b2Vec2;
const b2BodyDef = Box2D.Dynamics.b2BodyDef;
const b2Body = Box2D.Dynamics.b2Body;
const b2FixtureDef = Box2D.Dynamics.b2FixtureDef;
const b2World = Box2D.Dynamics.b2World;
const b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape;
const b2CircleShape = Box2D.Collision.Shapes.b2CircleShape;
b2PrismaticJointDef = Box2D.Dynamics.Joints.b2PrismaticJointDef;
b2DistanceJointDef = Box2D.Dynamics.Joints.b2DistanceJointDef;
b2RevoluteJointDef = Box2D.Dynamics.Joints.b2RevoluteJointDef;

class BonkPhysics {
  constructor() {
    this.world = new b2World(new b2Vec2(0, 20));
    this.world.SetWarmStarting(false);
  }
  step(seconds, gst, inputs) {

    // reset world
    this.world.novakReset();

    const shapes = [];
    const bodies = [];
    const joints = [];
    const discs = [];

    // create shapes
    for (let i = 0; i != gst.physics.shapes.length; i++) {
      let shapeObj;
      let pointArray;
      const shape = gst.physics.shapes[i];
      switch (shape.type) {
        case 'bx':
          shapeObj = new b2PolygonShape;
          const width = shape.w / 2;
          const height = shape.h / 2;
          pointArray = [];
          pointArray.push(new b2Vec2(width, -height));
          pointArray.push(new b2Vec2(width, height));
          pointArray.push(new b2Vec2(-width, height));
          pointArray.push(new b2Vec2(-width, -height));
          for (let i = 0; i != pointArray.length; i++) {
            pointArray[i] = bonkMath.rotateVec2(pointArray[i], shape.a);
            pointArray[i].x += shape.c[0];
            pointArray[i].y += shape.c[1];
          }
          shapeObj.SetAsArray(pointArray);
          shapes.push(shapeObj);
          break;
        case 'ci':
          shapeObj = new b2CircleShape;
          shapeObj.SetRadius(shape.r);
          shapeObj.SetLocalPosition(new b2Vec2(shape.c[0], shape.c[1]));
          shapes.push(shapeObj);
          break;
        case 'po':
          shapeObj = new b2PolygonShape;
          pointArray = [];
          for (let i2 = 0; i2 != shape.v.length; i2++) {
            pointArray.push(new b2Vec2(shape.v[i2][0] * shape.s, shape.v[i2][1] * shape.s));
          }
          shapeObj.SetAsArray(pointArray);
          shapes.push(shapeObj);
          break;
      }
    }

    const capZoneFixtures = new Set((gst.capZones || []).map(zone => zone.i));

    // create bodies and fixtures
    for (let i = 0; i != gst.physics.bodies.length; i++) {
      const body = gst.physics.bodies[i];
      const bodyDef = new b2BodyDef();
      switch (body.type) {
        case 'd':
          bodyDef.type = b2Body.b2_dynamicBody;
          break;
        case 's':
          bodyDef.type = b2Body.b2_staticBody;
          break;
        case 'k':
          bodyDef.type = b2Body.b2_kinematicBody;
          break;
      }

      bodyDef.position.x = body.p[0];
      bodyDef.position.y = body.p[1];
      bodyDef.angle = body.a;
      bodyDef.linearVelocity.x = body.lv[0];
      bodyDef.linearVelocity.y = body.lv[1];
      bodyDef.angularVelocity = body.av;
      bodyDef.angularDamping = body.ad;
      bodyDef.linearDamping = body.ld;
      // A body pinned to a joint is never held at a fixed rotation, whatever the map says:
      // the joint decides how it turns. Honouring the flag anyway leaves a body hanging off
      // a hinge unable to swing.
      let fixedRotation = body.fr;
      if (fixedRotation) {
        for (const joint of gst.physics.joints) {
          if (joint && (joint.ba === i || joint.bb === i)) { fixedRotation = false; break; }
        }
      }
      bodyDef.fixedRotation = fixedRotation;
      // Continuous collision for a body the map marks as a bullet.
      bodyDef.bullet = body.bu === true;
      bodyDef.allowSleep = false;
      const bodyObj = this.world.CreateBody(bodyDef);
      for (let i2 = 0; i2 != body.fx.length; i2++) {
        const fixture = gst.physics.fixtures[body.fx[i2]];
        if (fixture.np) continue;
        const fixtureDef = new b2FixtureDef;
        fixtureDef.shape = shapes[fixture.sh];
        // Map fixtures inherit only when the override is null; zero is a valid value.
        fixtureDef.density = fixture.de ?? body.de;
        fixtureDef.restitution = fixture.re ?? body.re;
        fixtureDef.friction = fixture.fr ?? body.fric;
        // Negative restitution and friction are meaningful and must reach the solver as-is:
        // this Box2D build's b2MixRestitution adds instead of taking the maximum when either
        // side is negative, so a surface at -1 cancels the disc's own bounce, and
        // b2MixFriction reads a negative surface against the disc's 0.001337 sentinel.
        // Clamping either to zero makes every surface as bouncy as the disc.
        // A cap zone is a region the player stands inside, not an obstacle: it keeps its
        // fixture so contacts still report, but it never blocks a disc.
        fixtureDef.isSensor = capZoneFixtures.has(body.fx[i2]);
        if (fixtureDef.density <= 0) fixtureDef.density = 0.0001;
        // A fixture marked with the friction-player flag has its friction flipped, which is
        // how a surface drags a disc along instead of slowing it.
        if (fixture.fp != null ? fixture.fp : body.fricp) fixtureDef.friction = -fixtureDef.friction;
        // Collision groups. Every body sits in one group, `f_c`, and chooses which of the
        // four groups and the players it collides with. Without this a map's layers all
        // collide with each other, so anything built to pass through something else does
        // not: platforms shove each other around and shapes meant to overlap fight.
        //
        //   a body's own category is 2^f_c * 2, leaving bit 1 for players and arrows
        //   its mask starts as everything, then drops the bit of each group it ignores
        // A body with no group recorded sits in group 1, which is the format's default.
        const collisionGroup = Number.isInteger(body.f_c) ? body.f_c : 1;
        fixtureDef.filter.categoryBits = Math.pow(2, collisionGroup) * 2;
        let maskBits = 65535;
        if (body.f_p === false) maskBits -= 1;
        if (body.f_1 === false) maskBits -= 4;
        if (body.f_2 === false) maskBits -= 8;
        if (body.f_3 === false) maskBits -= 16;
        if (body.f_4 === false) maskBits -= 32;
        fixtureDef.filter.maskBits = maskBits;
        const fixtureObj = bodyObj.CreateFixture(fixtureDef);
        // MAPFORMAT.md: a fixture's 'd' flag marks it as a death surface.
        fixtureObj.SetUserData({ fixtureIndex: body.fx[i2], death: fixture.d === true,
          capzone: capZoneFixtures.has(body.fx[i2]), bodyIndex: i });
      }
      bodyObj.SetLinearVelocity(new b2Vec2(body.lv[0], body.lv[1]));
      // A body can carry a constant force, which is what drives a map's conveyors and
      // powered platforms. It is added to the body's own speed each frame, and only once a
      // round is actually running. `w` says whether the push is in world terms or the
      // body's own, and `ct` spins it.
      if (body.cf && (gst.ftu ?? -1) === -1) {
        if (body.cf.x !== 0 || body.cf.y !== 0) {
          let push = new b2Vec2(body.cf.x, body.cf.y);
          if (body.cf.w === false) push = bodyObj.GetWorldVector(push, push);
          const moving = bodyObj.GetLinearVelocity();
          moving.x += push.x;
          moving.y += push.y;
        }
        if (body.cf.ct !== 0) bodyObj.SetAngularVelocity(bodyObj.GetAngularVelocity() + body.cf.ct);
      }
      // Which map body this is, so a force zone can be found from a contact.
      bodyObj.SetUserData({ mapBodyIndex: i });
      bodies[i] = bodyObj;
    }

    // create joints
    for (let i = 0; i != gst.physics.joints.length; i++) {
      const joint = gst.physics.joints[i];
      const bodyA = joint.ba == -1 ? this.world.GetGroundBody() : bodies[joint.ba];
      const bodyB = joint.bb == -1 ? this.world.GetGroundBody() : bodies[joint.bb];
      let jointObj;
      switch (joint.type) {
        case 'lpj':
          const ang = joint.pa - bodyA.GetAngle();
          const cosAng = bonkMath.fixedTrig.cos(ang);
          const sinAng = bonkMath.fixedTrig.sin(ang);
          jointObj = new b2PrismaticJointDef();
          jointObj.bodyA = bodyA;
          jointObj.localAnchorA = new b2Vec2();
          jointObj.bodyB = bodyB;
          jointObj.localAnchorB = new b2Vec2(joint.pax, joint.pay);
          jointObj.referenceAngle = -bodyA.GetAngle();
          jointObj.upperTranslation = joint.plen;
          jointObj.lowerTranslation = -joint.plen;
          jointObj.enableLimit = true;
          jointObj.localAxisA = new b2Vec2(cosAng, sinAng);
          jointObj.enableMotor = true;
          jointObj.maxMotorForce = joint.pf;
          jointObj.motorSpeed = joint.pms;
          const A7S = [];
          A7S[72] = joint.pax + bonkMath.fixedTrig.cos(joint.pa) * -joint.plen;
          A7S[22] = joint.pay + bonkMath.fixedTrig.sin(joint.pa) * -joint.plen;
          A7S[85] = bodyA.GetPosition().Copy();
          A7S[85].Subtract(new b2Vec2(A7S[72], A7S[22]));
          A7S[91] = A7S[85].Length();
          A7S[82] = A7S[91] / (joint.plen * 2);
          A7S[82] -= 0.5;
          A7S[82] *= 2;
          if (joint.pms < 0 && A7S[82] > 0.99 || joint.pms > 0 && A7S[82] < -0.99) {
            jointObj.motorSpeed = -jointObj.motorSpeed;
            bodyA.SetLinearVelocity(new b2Vec2(0, 0));
          }
          joints.push(this.world.CreateJoint(jointObj));
          break;
        case 'lsj': {
          // A soft slider: a prismatic joint on the body's own up axis, with a motor whose
          // force and direction follow how far along its travel the body already is. The
          // vendored copy of this case did not run at all — it reached for an unresolved
          // name, and shared a variable with the case above it — so every map with one of
          // these threw on the first frame.
          const quarterTurn = Math.PI / 2;
          jointObj = new b2PrismaticJointDef();
          jointObj.bodyA = bodyA;
          jointObj.localAnchorA = new b2Vec2();
          jointObj.bodyB = bodyB;
          jointObj.localAnchorB = new b2Vec2(joint.sax, joint.say);
          jointObj.referenceAngle = -bodyA.GetAngle();
          jointObj.upperTranslation = joint.slen;
          jointObj.lowerTranslation = -joint.slen;
          jointObj.enableLimit = false;
          jointObj.localAxisA = new b2Vec2(0, 1);
          jointObj.enableMotor = true;
          jointObj.maxMotorForce = joint.sf;
          jointObj.motorSpeed = 300;
          const axisAngle = bodyA.GetAngle() - quarterTurn;
          const lowEndX = joint.sax + bonkMath.fixedTrig.cos(axisAngle) * -joint.slen;
          const lowEndY = joint.say + bonkMath.fixedTrig.sin(axisAngle) * -joint.slen;
          const fromLowEnd = bodyA.GetPosition().Copy();
          fromLowEnd.Subtract(new b2Vec2(lowEndX, lowEndY));
          let travelled = fromLowEnd.Length();
          let bearing = bonkMath.fixedTrig.atan2(fromLowEnd.y, fromLowEnd.x) - bodyA.GetAngle();
          bearing = bearing % (2 * Math.PI);
          // Behind the low end, the distance counts as negative travel.
          if (!(bearing < 0 && bearing >= -Math.PI || bearing > Math.PI)) travelled = -travelled;
          // Where it sits along its travel, as -1 at one end to 1 at the other.
          const along = travelled / (joint.slen * 2) * 2 - 1;
          jointObj.maxMotorForce = joint.sf * Math.abs(along);
          if (along > 0) jointObj.motorSpeed = -300;
          joints.push(this.world.CreateJoint(jointObj));
          break;
        }
        case 'rv':
          jointObj = new b2RevoluteJointDef();
          jointObj.bodyA = bodyA;
          jointObj.bodyB = bodyB;
          jointObj.localAnchorA.Set(joint.aa[0], joint.aa[1]);
          jointObj.localAnchorB.Set(joint.ab[0], joint.ab[1]);
          jointObj.enableLimit = joint.d.el;
          jointObj.lowerAngle = joint.d.la;
          jointObj.upperAngle = joint.d.ua;
          jointObj.enableMotor = joint.d.em;
          jointObj.motorSpeed = joint.d.ms;
          jointObj.maxMotorTorque = joint.d.mmt;
          jointObj.collideConnected = joint.d.cc === true;
          joints.push(this.world.CreateJoint(jointObj));
          break;
        case 'p':
          jointObj = new b2PrismaticJointDef();
          jointObj.bodyA = bodyA;
          jointObj.bodyB = bodyB;
          jointObj.localAnchorA.Set(joint.aa[0], joint.aa[1]);
          jointObj.localAnchorB.Set(joint.ab[0], joint.ab[1]);
          jointObj.localAxisA.Set(joint.axa[0], joint.axa[1]);
          jointObj.enableLimit = joint.d.el;
          jointObj.lowerTranslation = joint.d.lt;
          jointObj.upperTranslation = joint.d.ut;
          jointObj.enableMotor = joint.d.em;
          jointObj.motorSpeed = joint.d.ms;
          jointObj.maxMotorForce = joint.d.mmf;
          jointObj.collideConnected = joint.d.cc === true;
          joints.push(this.world.CreateJoint(jointObj));
          jointTranslation = joints[i].GetJointTranslation();
          const userData = {
            changeSide: joint.cs,
          };
          if (joint.d.cd && joint.d.el) {
            if ((joint.cs == 0 || joint.cs == 1) && jointTranslation > 0 && jointTranslation / joint.d.ut > 0.99) {
              joints[i].SetMotorSpeed(-joints[i].GetMotorSpeed());
              userData.changeSide = 2;
            } else if ((joint.cs == 0 || joint.cs == 2) && jointTranslation < 0 && jointTranslation / joint.d.lt > 0.99) {
              joints[i].SetMotorSpeed(-joints[i].GetMotorSpeed());
              userData.changeSide = 1;
            }
          }
          joints[i].SetUserData(userData);
          break;
        case 'd':
          jointObj = new b2DistanceJointDef();
          jointObj.bodyA = bodyA;
          jointObj.bodyB = bodyB;
          jointObj.localAnchorA.Set(joint.aa[0], joint.aa[1]);
          jointObj.localAnchorB.Set(joint.ab[0], joint.ab[1]);
          // The rest length is fixed when the state is built, never measured here: taking
          // it from where the bodies happen to be this frame would move the target the
          // spring is pulling towards, and the joint would never pull anything back.
          jointObj.length = joint.len;
          jointObj.frequencyHz = joint.d.fh;
          jointObj.dampingRatio = joint.d.dr;
          jointObj.collideConnected = joint.d.cc === true;
          joints.push(this.world.CreateJoint(jointObj));
          break;
      }
    }

    for (let i = 0; i != gst.discs.length; i++) {
      if (!gst.discs[i]) continue;
      const disc = gst.discs[i];

      // A disc can be sized by the room's balance setting; the original adds the balance
      // percentage to the radius, so +25 makes a disc a quarter larger.
      const discRadius = typeof disc.r === 'number' ? disc.r : 1;
      const discShapeDef = new b2CircleShape(discRadius);
      const discFixtureDef = new b2FixtureDef();
      const discBodyDef = new b2BodyDef();

      discFixtureDef.shape = discShapeDef;
      // Mass changes must enter the collision solver, not just movement force. The original
      // adds 3.7 times the base density at a full ability meter, so a fully charged heavy is
      // 4.7 times as dense as a light disc, not half again as dense.
      discFixtureDef.density = (1 + 3.7 * (disc.heavyStrength || 0)) / Math.PI;
      discFixtureDef.friction = 0.001337;
      discFixtureDef.restitution = 0.95;
      // Discs are the players' category, which is the bit a body drops when it is set not to
      // collide with players.
      discFixtureDef.filter.categoryBits = 1;

      discBodyDef.type = b2Body.b2_dynamicBody;
      discBodyDef.position.x = disc.x;
      discBodyDef.position.y = disc.y;
      discBodyDef.angle = disc.a;
      discBodyDef.linearVelocity.x = disc.xv;
      discBodyDef.linearVelocity.y = disc.yv;
      discBodyDef.angularVelocity = disc.av;
      discBodyDef.angularDamping = 3.4;
      discBodyDef.linearDamping = 0.01;
      discBodyDef.fixedRotation = true;
      // Continuous collision. Without this a disc moving quickly jumps straight past a thin
      // wall between one step and the next, ending up outside the map and dying there.
      discBodyDef.bullet = true;

      const discBody = this.world.CreateBody(discBodyDef);
      discBody.CreateFixture(discFixtureDef);
      discBody.SetUserData({ discId: i });

      const moveVector = new b2Vec2(0, 0);
      // The original's walking force, doubled on a map that asks for it with the 'fl' flag.
      // A larger disc pushes harder, by its area, which is how the original keeps a sized
      // disc moving like a normal one.
      const moveAcc = (gst.ms && gst.ms.fl ? 20 : 12) * discRadius * discRadius;

      if (inputs[i].up) {
        moveVector.y = -moveAcc;
      } else if (inputs[i].down) {
        moveVector.y = moveAcc;
      }
      // While a bow is drawn the left and right keys aim instead of walking, so only the
      // vertical part of the push is left.
      if (!disc.ds) {
        if (inputs[i].left) {
          moveVector.x = -moveAcc;
        } else if (inputs[i].right) {
          moveVector.x = moveAcc;
        }
      }
      // Holding heavy costs a flat 30% of the walking force in the original, whatever the
      // meter reads.
      if (disc.a1) moveVector.Multiply(0.7);
      discBody.ApplyForce(moveVector, discBody.GetWorldCenter());

      if (inputs[i].up && Math.abs(disc.yv) < 4) {
        const rayPointA = new b2Vec2(disc.x, disc.y);
        const rayPointB = new b2Vec2(disc.x, disc.y + discRadius + 0.15);
        // The jump is a short ray straight down: hit something and the disc is shoved
        // upwards. What counts as something to push off is the original's list, and the
        // ray used to accept anything at all — which is how a player could jump off a
        // capture zone, a black surface, or a shape set not to collide with players.
        this.world.RayCast(rayFixture => {
          const bodyData = rayFixture.GetBody().GetUserData();
          // Only the map pushes back: not other players, not arrows.
          if (!bodyData || !Number.isInteger(bodyData.mapBodyIndex)) return -1;
          const source = gst.physics.bodies[bodyData.mapBodyIndex];
          // A force zone is not a surface.
          if (source && source.fz && source.fz.on) return -1;
          const data = rayFixture.GetUserData() || {};
          if (data.capzone || data.death) return -1;
          // Nor is anything that does not collide with players in the first place.
          if ((rayFixture.GetFilterData().maskBits & 1) !== 1) return -1;
          discBody.GetLinearVelocity().y -= 10;
          return 0;
        }, rayPointA, rayPointB);
      }

      discs[i] = discBody;
    }

    // Arrows are physical rectangles: they collide, rotate and remain after impact.
    const arrowBodies = [];
    for (const arrow of gst.modeState?.projectiles || []) {
      const definition = new b2BodyDef();
      definition.type = b2Body.b2_dynamicBody;
      definition.position.Set(arrow.x, arrow.y);
      definition.linearVelocity.Set(arrow.xv, arrow.yv);
      // An arrow travelling at any speed points along its flight and does not spin. Once it
      // has slowed to a crawl it keeps whatever angle and spin it had, and tumbles from
      // there: that is what makes one skidding to a halt settle instead of swinging round
      // to follow every last dribble of movement. There is no damping on the spin.
      if (Math.hypot(arrow.xv, arrow.yv) > 4) {
        definition.angle = Math.round(Math.atan2(arrow.yv, arrow.xv) * 1e7) / 1e7;
        definition.angularVelocity = 0;
      } else {
        definition.angle = arrow.a;
        definition.angularVelocity = arrow.av || 0;
      }
      definition.angularDamping = 0;
      definition.bullet = true;
      const shape = new b2PolygonShape();
      // The original's arrow: one unit long, half a unit tall, and fully elastic, which is
      // why one hitting a wall bounces away rather than dropping dead.
      shape.SetAsBox(0.5, 0.25);
      const fixture = new b2FixtureDef();
      fixture.shape = shape;
      fixture.density = 2.5;
      fixture.friction = 0.5;
      fixture.restitution = 1;
      const body = this.world.CreateBody(definition);
      body.CreateFixture(fixture);
      body.SetUserData({ arrowOwner: arrow.owner, age: arrow.age });
      arrowBodies.push(body);
    }
    const contacts = new Box2D.Dynamics.b2ContactListener();
    // A force zone is a map body that stops being solid and instead pushes whatever overlaps
    // it. The world is rebuilt every step, so every overlap is a fresh contact and this runs
    // once a frame for each thing inside a zone, which is what makes it a steady force.
    const applyForceZone = (contact, zoneBody, otherBody) => {
      const zoneData = zoneBody.GetUserData();
      if (!zoneData || !Number.isInteger(zoneData.mapBodyIndex)) return;
      const source = gst.physics.bodies[zoneData.mapBodyIndex];
      const zone = source && source.fz;
      if (!zone || !zone.on) return;
      // Nothing collides with a zone, it only pushes.
      contact.SetEnabled(false);
      let force = new b2Vec2(zone.x, zone.y);
      if (zone.t === 1) {
        // Turned with the body, so the push follows a rotating zone.
        const cos = bonkMath.fixedTrig.cos(source.a), sin = bonkMath.fixedTrig.sin(source.a);
        force = new b2Vec2(zone.x * cos - zone.y * sin, zone.x * sin + zone.y * cos);
      } else if (zone.t === 2 || zone.t === 3) {
        // Pointed at or away from the zone's middle: type 2 pushes out, type 3 pulls in.
        const target = otherBody.GetPosition();
        const pull = new b2Vec2(source.p[0] - target.x, source.p[1] - target.y);
        pull.Normalize();
        pull.Multiply(zone.t === 2 ? -zone.cf : zone.cf);
        force = pull;
      }
      const other = otherBody.GetUserData() || {};
      const isDisc = Number.isInteger(other.discId);
      const isArrow = Number.isInteger(other.arrowOwner);
      const isBody = Number.isInteger(other.mapBodyIndex);
      if ((isDisc && zone.d) || (isArrow && zone.a) || (isBody && zone.p)) {
        otherBody.ApplyForce(force, otherBody.GetWorldCenter());
      }
    };
    contacts.BeginContact = contact => {
      const bodyA = contact.GetFixtureA().GetBody();
      const bodyB = contact.GetFixtureB().GetBody();
      applyForceZone(contact, bodyA, bodyB);
      applyForceZone(contact, bodyB, bodyA);
    };
    // Whether this room is playing teams, which decides if team-mates bump into each other.
    const playingTeams = typeof matchTeams !== 'undefined' && matchTeams;
    contacts.PreSolve = contact => {
      // Two discs pass through each other on a map that asks for it, and team-mates always
      // pass through each other in a team game.
      const discA = contact.GetFixtureA().GetBody().GetUserData();
      const discB = contact.GetFixtureB().GetBody().GetUserData();
      if (Number.isInteger(discA?.discId) && Number.isInteger(discB?.discId)) {
        const noCollide = gst.ms && gst.ms.nc;
        const sameTeam = playingTeams
          && gst.discs[discA.discId] && gst.discs[discB.discId]
          && gst.discs[discA.discId].team === gst.discs[discB.discId].team;
        if (noCollide || sameTeam) contact.SetEnabled(false);
      }
      // A zone never solves as a collision, however the pair came in.
      const zoneOf = body => {
        const data = body.GetUserData();
        if (!data || !Number.isInteger(data.mapBodyIndex)) return null;
        const source = gst.physics.bodies[data.mapBodyIndex];
        return source && source.fz && source.fz.on ? source : null;
      };
      if (zoneOf(contact.GetFixtureA().GetBody()) || zoneOf(contact.GetFixtureB().GetBody())) {
        contact.SetEnabled(false);
      }
      const a = contact.GetFixtureA().GetBody().GetUserData();
      const b = contact.GetFixtureB().GetBody().GetUserData();
      // A player's own arrows never collide with that player.
      if ((Number.isInteger(a?.arrowOwner) && a.arrowOwner === b?.discId) ||
          (Number.isInteger(b?.arrowOwner) && b.arrowOwner === a?.discId)) contact.SetEnabled(false);
    };
    this.world.SetContactListener(contacts);

    // A slack web has no force. Once stretched, it pulls toward its anchor;
    // unlike a distance joint it never pushes or holds a player at a fixed radius.
    for (let id = 0; id < (gst.modeState?.grapples.length || 0); id++) {
      const rope = gst.modeState.grapples[id];
      if (!rope || !discs[id] || !bodies[rope.bodyIndex]) continue;
      const discBody = discs[id], anchorBody = bodies[rope.bodyIndex];
      const anchor = anchorBody.GetWorldPoint(new b2Vec2(rope.localX, rope.localY));
      const position = discBody.GetWorldCenter();
      const dx = position.x - anchor.x, dy = position.y - anchor.y;
      const distance = Math.hypot(dx, dy);
      if (distance < rope.length || distance === 0) continue;
      const discVelocity = discBody.GetLinearVelocity();
      const anchorVelocity = anchorBody.GetLinearVelocityFromWorldPoint(anchor);
      const nx = dx / distance, ny = dy / distance;
      const outward = (discVelocity.x - anchorVelocity.x) * nx + (discVelocity.y - anchorVelocity.y) * ny;
      const tension = discBody.GetMass() * Math.max(0, 75 * (distance - rope.length) + 5 * outward);
      const force = new b2Vec2(-nx * tension, -ny * tension);
      discBody.ApplyForce(force, position);
      anchorBody.ApplyForce(new b2Vec2(-force.x, -force.y), anchor);
    }

    // after everything is set up, step
    // A round opens frozen. The original does not step the world at all until its round-in
    // countdown reaches -1, so nothing falls, drifts or settles while players wait.
    if ((gst.ftu ?? -1) === -1) this.world.Step(seconds, 2, 6);
    this.world.ClearForces();

    gst.playerContacts = [];
    gst.arrowHits = [];
    gst.deathContacts = [];
    for (let contact = this.world.GetContactList(); contact; contact = contact.GetNext()) {
      if (!contact.IsTouching()) continue;
      const fixtureA = contact.GetFixtureA();
      const fixtureB = contact.GetFixtureB();
      const dataA = fixtureA.GetBody().GetUserData();
      const dataB = fixtureB.GetBody().GetUserData();
      const a = dataA?.discId;
      const b = dataB?.discId;
      if (Number.isInteger(a) && Number.isInteger(b)) gst.playerContacts.push([a, b]);
      // Death Arrows needs to know which disc an arrow struck.
      if (Number.isInteger(dataA?.arrowOwner) && Number.isInteger(b)) gst.arrowHits.push([dataA.arrowOwner, b]);
      if (Number.isInteger(dataB?.arrowOwner) && Number.isInteger(a)) gst.arrowHits.push([dataB.arrowOwner, a]);
      // Touching a death fixture is the map-defined kill.
      if (Number.isInteger(a) && fixtureB.GetUserData()?.death) gst.deathContacts.push(a);
      if (Number.isInteger(b) && fixtureA.GetUserData()?.death) gst.deathContacts.push(b);
    }
    arrowBodies.forEach((body, index) => {
      const arrow = gst.modeState.projectiles[index];
      Object.assign(arrow, { x: body.GetPosition().x, y: body.GetPosition().y,
        xv: body.GetLinearVelocity().x, yv: body.GetLinearVelocity().y,
        a: body.GetAngle(),
        av: body.GetAngularVelocity(), age: arrow.age + seconds });
    });

    // save everything back into the gst
    for (let i = 0; i != gst.physics.bodies.length; i++) {
      gst.physics.bodies[i].p = [bodies[i].GetPosition().x, bodies[i].GetPosition().y];
      gst.physics.bodies[i].a = bodies[i].GetAngle();
      gst.physics.bodies[i].av = bodies[i].GetAngularVelocity();
      gst.physics.bodies[i].lv = [bodies[i].GetLinearVelocity().x, bodies[i].GetLinearVelocity().y];
      gst.physics.bodies[i].ld = bodies[i].GetLinearDamping();
      gst.physics.bodies[i].ad = bodies[i].GetAngularDamping();
      gst.physics.bodies[i].fr = bodies[i].IsFixedRotation();
      gst.physics.bodies[i].bu = bodies[i].IsBullet();
    }
    for (let i = 0; i != gst.discs.length; i++) {
      if (!gst.discs[i]) continue;
      const disc = gst.discs[i];
      disc.x = discs[i].GetPosition().x;
      disc.y = discs[i].GetPosition().y;
      disc.xv = discs[i].GetLinearVelocity().x;
      disc.yv = discs[i].GetLinearVelocity().y;
      gst.discs[i] = disc;
    }
    for (let i = 0; i != gst.physics.joints.length; i++) {
      const joint = gst.physics.joints[i];
      switch (joint.type) {
        case 'p':
          if (joints[i].GetUserData()) {
            joint.cs = joints[i].GetUserData().changeSide;
            joint.d.ms = joints[i].GetMotorSpeed();
          }
          break;
        case 'lpj':
          joint.pms = joints[i].GetMotorSpeed();
          break;
      }
    }

    // return the gst
    return gst;
  }
}
