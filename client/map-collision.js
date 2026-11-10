'use strict';

// Grapple searches in every direction, independently of the movement keys.
function nearestGrapplePoint(state, point, radius) {
  let nearest = null;
  const accept = (x, y, bodyIndex, fixtureIndex) => {
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { x, y, distance, bodyIndex, fixtureIndex };
  };
  state.physics.bodies.forEach((body, bodyIndex) => {
    const transform = (x, y) => ({ x: body.p[0] + x * Math.cos(body.a) - y * Math.sin(body.a), y: body.p[1] + x * Math.sin(body.a) + y * Math.cos(body.a) });
    for (const fixtureIndex of body.fx) {
      const fixture = state.physics.fixtures[fixtureIndex];
      if (fixture.np || fixture.ng) continue;
      const shape = state.physics.shapes[fixture.sh];
      if (shape.type === 'ci') {
        const center = transform(...shape.c);
        const dx = point.x - center.x, dy = point.y - center.y;
        const distance = Math.hypot(dx, dy);
        const scale = distance ? shape.r / distance : 0;
        accept(center.x + dx * scale, center.y + dy * scale, bodyIndex, fixtureIndex);
        continue;
      }
      let vertices;
      if (shape.type === 'bx') vertices = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy]) => {
        const x = sx * shape.w / 2, y = sy * shape.h / 2;
        return transform(shape.c[0] + x * Math.cos(shape.a) - y * Math.sin(shape.a), shape.c[1] + x * Math.sin(shape.a) + y * Math.cos(shape.a));
      });
      else if (shape.type === 'po') vertices = shape.v.map(([x,y]) => transform(x * shape.s, y * shape.s));
      else continue;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        accept(a.x + t * dx, a.y + t * dy, bodyIndex, fixtureIndex);
      }
    }
  });
  return nearest;
}

// Segment casts in map coordinates. They use fixture geometry, including rotation.
function castMapSegment(state, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return null;
  let hit = null;
  const accept = (t, bodyIndex) => {
    if (t >= 0 && t <= 1 && (!hit || t < hit.t)) hit = { t, x: start.x + dx * t, y: start.y + dy * t, bodyIndex };
  };
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const edge = (a, b, bodyIndex) => {
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = cross(dx, dy, ex, ey);
    if (Math.abs(denominator) < 1e-10) return;
    const ax = a.x - start.x, ay = a.y - start.y;
    const t = cross(ax, ay, ex, ey) / denominator;
    const u = cross(ax, ay, dx, dy) / denominator;
    if (u >= 0 && u <= 1) accept(t, bodyIndex);
  };
  state.physics.bodies.forEach((body, bodyIndex) => {
    const transform = (x, y) => ({ x: body.p[0] + x * Math.cos(body.a) - y * Math.sin(body.a), y: body.p[1] + x * Math.sin(body.a) + y * Math.cos(body.a) });
    for (const fixtureIndex of body.fx) {
      const fixture = state.physics.fixtures[fixtureIndex];
      if (fixture.np) continue;
      const shape = state.physics.shapes[fixture.sh];
      if (shape.type === 'ci') {
        const center = transform(...shape.c);
        const ox = start.x - center.x, oy = start.y - center.y;
        const b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - shape.r * shape.r;
        const discriminant = b * b - 4 * lengthSquared * c;
        if (discriminant < 0) continue;
        accept((-b - Math.sqrt(discriminant)) / (2 * lengthSquared), bodyIndex);
        accept((-b + Math.sqrt(discriminant)) / (2 * lengthSquared), bodyIndex);
        continue;
      }
      let vertices;
      if (shape.type === 'bx') {
        vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
          const x = sx * shape.w / 2, y = sy * shape.h / 2;
          return transform(shape.c[0] + x * Math.cos(shape.a) - y * Math.sin(shape.a), shape.c[1] + x * Math.sin(shape.a) + y * Math.cos(shape.a));
        });
      } else if (shape.type === 'po') vertices = shape.v.map(([x, y]) => transform(x * shape.s, y * shape.s));
      else continue;
      for (let i = 0; i < vertices.length; i++) edge(vertices[i], vertices[(i + 1) % vertices.length], bodyIndex);
    }
  });
  return hit;
}
