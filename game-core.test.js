'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('./game-core.js');
const map = require('./game-map.js');

const STEP = 1 / 60;
const IDLE = { x: 0, y: 0, sprint: false };

function tick(game, count, controls = IDLE) {
  for (let frame = 0; frame < count; frame += 1) core.step(game, controls, STEP);
}

function openFloor() {
  const game = core.createGame(0);
  game.floor.tiles.fill(1);
  for (let y = 1; y < core.HEIGHT - 1; y += 1) {
    for (let x = 1; x < core.WIDTH - 1; x += 1) game.floor.tiles[core.tileAt(x, y)] = 0;
  }
  game.floor.roomsByTile.fill(-1);
  game.floor.guards = [];
  game.floor.lookouts.clear();
  game.floor.goalTile = core.tileAt(38, 28);
  game.floor.goalTiles = [game.floor.goalTile];
  return game;
}

function followExitRoute(game) {
  const floors = [];
  let floor;
  let previous;
  let target;
  for (let frame = 0; game.phase === 'playing' && frame < 20000; frame += 1) {
    const { player } = game;
    if (game.floor !== floor) {
      floor = game.floor;
      floors.push(floor.number);
      previous = core.walkableTiles(floor.tiles, floor.goalTile).previous;
      target = previous[floor.spawnTile];
    }
    let point = core.tileCenter(target);
    if (Math.abs(player.x - point.x) <= 0.045 && Math.abs(player.y - point.y) <= 0.045) {
      target = previous[target];
      point = core.tileCenter(target);
    }
    const dx = point.x - player.x;
    const dy = point.y - player.y;
    const x = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
    const y = x === 0 ? Math.sign(dy) : 0;
    const sprint = player.stamina > 0.2 && floor.guards.some(guard => guard.mode !== 'patrol');
    core.step(game, { x, y, sprint }, STEP);
  }
  return floors;
}

test('1,600 seeded floors have wide, connected corridors and furnished dorm rooms', () => {
  const kinds = new Set();
  let lounges = 0;
  for (let seed = 0; seed < 320; seed += 1) {
    for (let number = 5; number >= 1; number -= 1) {
      const floor = core.createFloor(number, seed);
      const { distance } = core.walkableTiles(floor.tiles, floor.spawnTile);
      kinds.add(floor.kind);
      assert.equal(floor.tiles.length, 43 * 31);
      assert.ok(floor.rooms.length >= 6 && floor.rooms.length <= 10);
      assert.ok(floor.tiles.every((value, tile) => value !== 0 || distance[tile] >= 0));
      assert.ok(distance[floor.goalTile] >= 26);
      assert.ok(floor.goalTiles.every(tile => floor.roomsByTile[tile] === -1 && distance[tile] >= 0));

      const [main, bypass] = floor.routes;
      for (const tile of main) {
        for (const row of [tile - core.WIDTH, tile, tile + core.WIDTH]) {
          assert.ok([row - 1, row, row + 1].every(space => floor.tiles[space] === 0 && floor.roomsByTile[space] === -1));
        }
      }
      for (const tile of bypass) {
        assert.ok([tile, tile + 1, tile + core.WIDTH, tile + core.WIDTH + 1].every(space => floor.tiles[space] === 0 && floor.roomsByTile[space] === -1));
      }

      assert.ok(floor.rooms.filter(room => room.lounge).length <= 1);
      for (const room of floor.rooms) {
        const { hall, wall, inside } = room.entrance;
        assert.equal(wall.length, 2);
        assert.ok([...hall, ...wall, ...inside].every(tile => floor.tiles[tile] === 0));
        const objects = floor.furniture.filter(object => floor.roomsByTile[core.tileAt(object.x, object.y)] === room.id);
        if (room.lounge) {
          lounges += 1;
          assert.ok(objects.some(object => object.kind === 'sofa'));
          assert.ok(objects.every(object => object.kind !== 'bunk' && object.kind !== 'wardrobe'));
        } else {
          assert.equal(objects.filter(object => object.kind === 'bunk').length, 1);
          assert.equal(objects.filter(object => object.kind === 'wardrobe').length, 1);
          assert.ok(objects.length >= 4);
        }
      }
      assert.ok(floor.lookouts.size > 0);
      assert.equal(floor.guards.length, [0, 5, 4, 3, 2, 2][number]);
      const spawns = new Set();
      for (const guard of floor.guards) {
        const spawn = core.tileAt(guard.x, guard.y);
        assert.ok(distance[spawn] >= 12);
        assert.equal(floor.roomsByTile[spawn], -1);
        assert.ok(guard.patrolRoute.includes(spawn));
        assert.ok(guard.patrolRoute.every(tile => floor.roomsByTile[tile] === -1 && floor.tiles[tile] === 0));
        spawns.add(spawn);
      }
      assert.equal(spawns.size, floor.guards.length);
    }
  }
  assert.deepEqual(kinds, new Set(['straight', 'dogleg', 'loop']));
  assert.ok(lounges > 0 && lounges < 1600);
  assert.deepEqual(core.createFloor(5, 1).tiles, core.createFloor(5, 1).tiles);
  assert.notDeepEqual(core.createFloor(5, 1).tiles, core.createFloor(5, 2).tiles);
});

test('walls and corners block a flashlight even when the target is inside its cone', () => {
  const { tiles } = openFloor().floor;
  const actor = { x: 5.5, y: 5.5, angle: 0 };
  const light = core.PLAYER_LIGHT;
  assert.equal(core.seesTarget(tiles, actor, { x: 10.5, y: 5.5 }, light), true);
  assert.equal(core.seesTarget(tiles, actor, { x: 10.6, y: 5.5 }, light), false);
  assert.equal(core.seesTarget(tiles, actor, { x: 5.5, y: 6.5 }, light), false);

  tiles[core.tileAt(6, 5)] = 1;
  assert.equal(core.seesTarget(tiles, actor, { x: 8.5, y: 5.5 }, light), false);
  assert.equal(core.seesTarget(tiles, actor, { x: 7.5, y: 7.5 }, light), false);
});

test('diagonal movement is normalized and the player cannot walk through walls', () => {
  const game = openFloor();
  Object.assign(game.player, { x: 5.5, y: 5.5 });
  tick(game, 60, { x: 1, y: 1 });
  assert.ok(Math.abs(Math.hypot(game.player.x - 5.5, game.player.y - 5.5) - 3) < 1e-8);
  assert.equal(game.player.angle, Math.PI / 4);

  Object.assign(game.player, { x: 5.5, y: 5.5 });
  game.floor.tiles[core.tileAt(6, 5)] = 1;
  tick(game, 60, { x: 1, y: 0 });
  assert.ok(game.player.x <= 6 - core.PLAYER_RADIUS);
});

test('low furniture blocks walking and guard movement while light reaches past it', () => {
  const game = openFloor();
  const { tiles } = game.floor;
  const player = game.player;
  Object.assign(player, { x: 5.5, y: 5.5, angle: 0 });
  tiles[core.tileAt(6, 5)] = map.FURNITURE;
  assert.equal(core.seesTarget(tiles, player, { x: 7.5, y: 5.5 }, core.PLAYER_LIGHT), true);
  tick(game, 60, { x: 1, y: 0 });
  assert.ok(player.x <= 6 - core.PLAYER_RADIUS);

  const guard = core.createFloor(5, 0).guards[0];
  Object.assign(guard, { x: 4.5, y: 5.5, angle: 0 });
  game.floor.guards = [guard];
  Object.assign(player, { x: 8.5, y: 5.5 });
  for (let frame = 0; frame < 150 && game.phase === 'playing'; frame += 1) {
    tick(game, 1);
    assert.equal(map.isSolid(tiles, Math.floor(guard.x), Math.floor(guard.y)), false);
  }
  assert.equal(game.phase, 'caught');
});

test('stamina recovers in four seconds when the player stops before exhaustion', () => {
  const game = openFloor();
  Object.assign(game.player, { x: 3.5, y: 11.5 });
  tick(game, 120, { x: 1, y: 0, sprint: true });
  assert.ok(Math.abs(game.player.stamina - 1) < 1e-8);
  tick(game, 45);
  assert.ok(Math.abs(game.player.stamina - 1) < 1e-8);
  tick(game, 159);
  assert.ok(game.player.stamina < 3);
  tick(game, 1);
  assert.equal(game.player.stamina, 3);
});

test('exhaustion slows walking and prevents sprinting until a full seven-second recovery', () => {
  const game = openFloor();
  Object.assign(game.player, { x: 3.5, y: 11.5 });
  const sprint = { x: 1, y: 0, sprint: true };
  tick(game, 180, sprint);
  assert.ok(Math.abs(game.player.x - 18.5) < 1e-8);
  assert.equal(game.player.stamina, 0);
  assert.equal(game.player.sprintLocked, true);
  assert.equal(game.player.exhausted, true);

  tick(game, 45, { ...IDLE, sprint: true });
  assert.ok(game.player.stamina < 1e-8);
  tick(game, 240, { ...IDLE, sprint: true });
  assert.ok(game.player.stamina < 3);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 20.3) < 1e-8);
  tick(game, 119, { ...IDLE, sprint: true });
  assert.equal(game.player.exhausted, true);
  tick(game, 1, { ...IDLE, sprint: true });
  assert.equal(game.player.exhausted, false);
  assert.equal(game.player.stamina, 3);
  assert.equal(game.player.sprintLocked, true);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 23.3) < 1e-8);

  tick(game, 1);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 28.3) < 1e-8);
  assert.ok(Math.abs(game.player.stamina - 2) < 1e-8);
});

test('sight expands on detection and each guard clears its alert after 2.5 continuous seconds', () => {
  const game = openFloor();
  const [first, second] = core.createFloor(1, 0).guards;
  Object.assign(first, { x: 10.5, y: 10.5, angle: 0 });
  Object.assign(second, { x: 30.5, y: 23.5, angle: 0, lookTime: 10 });
  game.floor.guards = [first, second];

  Object.assign(game.player, { x: 14.5, y: 10.5 });
  assert.equal(core.guardLight(first).range, 6.5);
  tick(game, 1);
  assert.equal(first.mode, 'chase');
  assert.equal(core.guardLight(first).range, 8.25);
  assert.equal(second.mode, 'patrol');

  game.player.x = 27.5;
  tick(game, 100);
  assert.equal(first.mode, 'search');
  assert.deepEqual(first.lastSeen, { x: 14.5, y: 10.5 });
  game.player.x = 21.5;
  tick(game, 1);
  assert.equal(first.mode, 'chase');
  assert.equal(first.unseenTime, 0);

  game.player.x = 33.5;
  tick(game, 149);
  assert.equal(first.mode, 'search');
  tick(game, 1);
  assert.equal(first.mode, 'patrol');
  assert.equal(core.guardLight(first).range, 6.5);
});

test('a patrolling guard pauses in the hall to turn its light into a doorway', () => {
  const game = openFloor();
  const guard = core.createFloor(5, 1).guards[0];
  const route = [core.tileAt(10, 10), core.tileAt(11, 10), core.tileAt(12, 10)];
  const waypoint = route[1];
  Object.assign(game.player, { x: 30.5, y: 25.5 });
  Object.assign(guard, {
    ...core.tileCenter(route[0]),
    angle: 0, direction: 1, patrolRoute: route, routeIndex: 1,
    path: [core.tileCenter(waypoint)], pathIndex: 0, lookCooldown: 0,
  });
  game.floor.guards = [guard];
  game.floor.lookouts.set(waypoint, [core.tileAt(11, 13)]);
  game.floor.random = () => 0;

  tick(game, 28);
  assert.equal(guard.mode, 'patrol');
  assert.equal(guard.angle, Math.PI / 2);
  assert.ok(guard.lookTime > 0);
  assert.equal(guard.x, 11.5);
  tick(game, 10);
  assert.equal(guard.x, 11.5);
});

test('stairs activate across the full hallway and leave the pursuing guard upstairs', () => {
  const game = core.createGame(1);
  const previousFloor = game.floor;
  const point = core.tileCenter(previousFloor.goalTiles[0]);
  Object.assign(game.player, point, { exhausted: true, stamina: 1 });
  Object.assign(previousFloor.guards[0], point, { mode: 'chase' });
  tick(game, 1);
  assert.equal(game.floor.number, 4);
  assert.equal(game.phase, 'playing');
  assert.equal(game.player.exhausted, true);
  assert.equal(game.player.stamina, 1);
  assert.ok(game.floor.guards.every(guard => guard.mode === 'patrol'));
  assert.notEqual(game.floor.guards[0], previousFloor.guards[0]);
});

test('waiting for patrols and taking side passages can clear all five floors unseen', () => {
  // One seed with a keyboard route of up, down, left, right and wait, one tile per symbol.
  const routes = [
    '.RRUUUURRRRRRRRRRRRRUUUUUUUUUURRRRRRRRRRRRRRR',
    '......UU...DLDDDDDLLLLDLLLLLLLLLLLLLLLLDLLDDDDDDDDDDDLLLLLLLL',
    '..............UUUUULLLLLLLLUUULUUUULLLLLLLLLLLLLLDD..LDDDLLLLLLLLL',
    '.......LLUUUUULLLLLLLLLLLLLUUUUUUUUUUUUU.LLLLLLULLLLLL',
    '........L.....RDDDDLLDDDL.D..........RDDRR..DLLDDDDRRRRRRRRRRRRRRRRRRRRRRRRRR',
  ];
  const movements = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], '.': [0, 0] };
  const game = core.createGame(0);
  const kinds = new Set();
  for (const [index, route] of routes.entries()) {
    const floor = game.floor;
    assert.equal(floor.number, 5 - index);
    kinds.add(floor.kind);
    for (const action of route) {
      const [x, y] = movements[action];
      for (let frame = 0; frame < 20 && game.floor === floor && game.phase === 'playing'; frame += 1) {
        core.step(game, {x, y, sprint: false}, STEP);
        assert.ok(floor.guards.every(guard => guard.mode === 'patrol'));
      }
    }
  }
  assert.equal(kinds.size, 3);
  assert.equal(game.phase, 'escaped');
});

test('heading directly through patrols can get the player caught and a retry starts a fresh floor', () => {
  const caughtRun = core.createGame(0);
  const originalTiles = caughtRun.floor.tiles;
  followExitRoute(caughtRun);
  assert.equal(caughtRun.phase, 'caught');

  const retry = core.createGame(2);
  assert.equal(retry.floor.number, 5);
  assert.equal(retry.phase, 'playing');
  assert.equal(retry.player.stamina, 3);
  assert.notDeepEqual(retry.floor.tiles, originalTiles);
});
