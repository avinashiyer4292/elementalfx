// Headless checks for the gravity package's rigid-body engine.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const { Body, World } = await import(pathToFileURL(join(root, 'packages/gravity/dist/index.js')).href);

/** A world with a floor whose top is at y = 600 and walls at x = 0 and x = 1200. */
function room() {
  const world = new World();
  world.add(new Body({ x: 600, y: 1100, width: 3200, height: 1000, density: 0 }));
  world.add(new Body({ x: -500, y: 0, width: 1000, height: 3000, density: 0 }));
  world.add(new Body({ x: 1700, y: 0, width: 1000, height: 3000, density: 0 }));
  return world;
}

function run(world, seconds, frame = 1 / 60) {
  let settledAt = null;
  for (let t = 0; t < seconds; t += frame) {
    world.step(frame);
    if (settledAt === null && world.settled) settledAt = t;
  }
  return settledAt;
}

function stack(world, count) {
  const boxes = [];
  for (let i = 0; i < count; i++) {
    boxes.push(world.add(new Body({ x: 400 + (i % 2) * 6, y: 575 - i * 50, width: 120, height: 50 })));
  }
  return boxes;
}

test('a tall stack stands and falls asleep', () => {
  const world = room();
  const boxes = stack(world, 10);
  const settledAt = run(world, 5);
  assert.ok(settledAt !== null && settledAt < 3, `settled at ${settledAt}`);
  const top = boxes.at(-1);
  assert.ok(Math.abs(top.angle) < 0.01, `top box tilted ${top.angle}`);
  assert.ok(Math.abs(top.x - 406) < 1, `top box drifted to ${top.x}`);
});

test('results do not depend on the frame rate', () => {
  const tops = [1 / 30, 1 / 60, 1 / 144].map((frame) => {
    const world = room();
    const boxes = stack(world, 6);
    run(world, 3, frame);
    return boxes.at(-1).y;
  });
  for (const y of tops) assert.ok(Math.abs(y - tops[0]) < 0.5, `tops ${tops.join(', ')}`);
});

test('a pile of words settles without escaping the room', () => {
  const world = room();
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let x = 20;
  let y = 30;
  const words = [];
  for (let i = 0; i < 200; i++) {
    const width = 20 + random() * 110;
    if (x + width > 1180) {
      x = 20;
      y += 30;
    }
    words.push(world.add(new Body({ x: x + width / 2, y: y + 11, width, height: 22 })));
    x += width + 8;
  }
  const settledAt = run(world, 10);
  assert.ok(settledAt !== null && settledAt < 6, `settled at ${settledAt}`);
  for (const word of words) {
    assert.ok(word.x > 0 && word.x < 1200 && word.y < 600, `word escaped to (${word.x}, ${word.y})`);
  }
});

test('bouncy bodies bounce, then rest', () => {
  const world = room();
  const ball = world.add(new Body({ x: 600, y: 100, width: 40, height: 40, shape: 'circle', restitution: 0.7 }));
  let bounces = 0;
  let previous = 0;
  for (let t = 0; t < 6; t += 1 / 60) {
    world.step(1 / 60);
    if (previous > 0 && ball.vy < 0) bounces++;
    previous = ball.vy;
  }
  assert.ok(bounces >= 3, `${bounces} bounces`);
  assert.ok(ball.sleeping);
  assert.ok(Math.abs(ball.y - 580) < 1.5, `ball at ${ball.y}`);
});

test('a grabbed body follows the pointer and keeps its speed when released', () => {
  const world = room();
  const box = world.add(new Body({ x: 300, y: 575, width: 80, height: 50 }));
  run(world, 1);
  const grab = world.grab(box, 300, 560);
  for (let i = 0; i < 60; i++) {
    grab.moveTo(300 + i * 5, 400 - i * 2);
    world.step(1 / 60);
  }
  // The grabbed point sits 15 px above the centre.
  assert.ok(Math.abs(box.x - 595) < 30, `box at x ${box.x}`);
  assert.ok(Math.abs(box.y - 15 - 282) < 30, `box held at y ${box.y}`);
  world.release(grab);
  assert.ok(box.vx > 150, `released at ${box.vx} px/s`);
  const x = box.x;
  world.step(1 / 60);
  assert.ok(box.x > x + 2, 'keeps moving after release');
});

test('removing a body wakes what rested on it', () => {
  const world = room();
  const [bottom, top] = stack(world, 2);
  run(world, 2);
  assert.ok(top.sleeping);
  const restY = top.y;
  world.remove(bottom);
  run(world, 1);
  assert.ok(top.y > restY + 40, `top stayed at ${top.y}`);
});
