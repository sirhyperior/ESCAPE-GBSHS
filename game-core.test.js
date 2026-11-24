'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('./game-core.js');
const map = require('./game-map.js');
const items = require('./game-items.js');

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
  game.floor.pickups = [];
  game.floor.lookouts.clear();
  game.floor.goalTile = core.tileAt(38, 28);
  game.floor.goalTiles = [game.floor.goalTile];
  return game;
}

function setPatrolHall(floor, firstX, lastX, y) {
  const route = Array.from({length: lastX - firstX + 1}, (_, index) => core.tileAt(firstX + index, y));
  floor.patrolLinks = new Map(route.map((tile, index) => [
    tile, new Set([route[index - 1], route[index + 1]].filter(neighbor => neighbor !== undefined)),
  ]));
  return route;
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
      previous = core.walkableTiles(floor.tiles, floor.goalTile, -1, floor.width).previous;
      target = previous[floor.spawnTile];
    }
    let point = core.tileCenter(target, floor.width);
    if (Math.abs(player.x - point.x) <= 0.045 && Math.abs(player.y - point.y) <= 0.045) {
      target = previous[target];
      point = core.tileCenter(target, floor.width);
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
  const itemIds = new Set();
  let lounges = 0;
  let bedrooms = 0;
  let bedroomItems = 0;
  for (let seed = 0; seed < 320; seed += 1) {
    for (let number = 5; number >= 1; number -= 1) {
      const floor = core.createFloor(number, seed);
      const { width, height } = floor;
      const depth = 5 - number;
      const extra = Math.max(0, depth - 1);
      const { distance } = core.walkableTiles(floor.tiles, floor.spawnTile, -1, width);
      kinds.add(floor.kind);
      assert.equal(width, 43 + 4 * (depth + extra));
      assert.equal(height, 31 + 2 * (depth + extra));
      assert.equal(floor.tiles.length, width * height);
      assert.ok(floor.rooms.length >= 6 && floor.rooms.length <= 10 + depth + extra);
      assert.equal(floor.routes.length, (floor.kind === 'dogleg' ? 2 : 4) + extra);
      assert.ok(floor.tiles.every((value, tile) => value !== 0 || distance[tile] >= 0));
      assert.ok(distance[floor.goalTile] >= 26);
      assert.ok(floor.goalTiles.every(tile => floor.roomsByTile[tile] === -1 && distance[tile] >= 0));
      if (number === 5) {
        assert.equal(floor.upTile, null);
        const home = floor.rooms[floor.homeRoomId];
        assert.equal(home.tile, floor.spawnTile);
        assert.ok(!home.lounge);
      } else {
        assert.equal(floor.homeRoomId, null);
        assert.equal(Math.abs(floor.upTile - floor.spawnTile), 1);
        assert.equal(floor.roomsByTile[floor.spawnTile], -1);
        assert.equal(floor.roomsByTile[floor.upTile], -1);
        assert.ok(distance[floor.upTile] >= 0);
        assert.ok(!floor.goalTiles.includes(floor.upTile));
      }

      assert.equal(floor.cameras.length, [0, 6, 4, 2, 0, 0][number]);
      if (floor.cameras.length) {
        const uncovered = floor.tiles.slice();
        uncovered[floor.upTile] = map.WALL;
        for (const camera of floor.cameras) {
          const tile = core.tileAt(camera.x, camera.y, width);
          assert.equal(floor.tiles[tile], 0);
          assert.equal(floor.roomsByTile[tile], -1);
          assert.equal(floor.doorways[tile], 0);
          for (const scanned of core.cameraSweepTiles(floor, camera)) uncovered[scanned] = map.WALL;
        }
        assert.equal(uncovered[floor.spawnTile], 0);
        const { distance } = core.walkableTiles(uncovered, floor.spawnTile, -1, width);
        assert.ok(floor.goalTiles.some(tile => distance[tile] >= 0), `camera-free route on floor ${number}, seed ${seed}`);
      }

      const [main, ...sideRoutes] = floor.routes;
      for (const tile of main) {
        for (const row of [tile - width, tile, tile + width]) {
          assert.ok([row - 1, row, row + 1].every(space => floor.tiles[space] === 0 && floor.roomsByTile[space] === -1));
        }
      }
      for (const route of sideRoutes) {
        for (const tile of route) {
          assert.ok([tile, tile + 1, tile + width, tile + width + 1].every(space => floor.tiles[space] === 0 && floor.roomsByTile[space] === -1));
        }
      }

      assert.ok(floor.rooms.filter(room => room.lounge).length <= 1);
      const itemsByRoom = new Map();
      for (const { id, x, y } of floor.pickups) {
        const tile = core.tileAt(x, y, width);
        const roomId = floor.roomsByTile[tile];
        assert.ok(roomId >= 0);
        assert.notEqual(roomId, floor.homeRoomId);
        assert.equal(floor.tiles[tile], 0);
        assert.notEqual(tile, floor.spawnTile);
        assert.ok(distance[tile] >= 0 && !itemsByRoom.has(roomId));
        assert.ok(!floor.furniture.some(object => (
          x >= object.x && x < object.x + object.width && y >= object.y && y < object.y + object.height
        )));
        itemsByRoom.set(roomId, id);
        itemIds.add(id);
      }
      for (const room of floor.rooms) {
        const area = room.width * room.height;
        const { hall, wall, inside } = room.entrance;
        assert.equal(wall.length, 2);
        assert.ok([...hall, ...wall, ...inside].every(tile => floor.tiles[tile] === 0));
        assert.equal(floor.roomsByTile[room.hidingTile], room.id);
        assert.equal(floor.tiles[room.hidingTile], 0);
        const hiding = core.tileCenter(room.hidingTile, width);
        const light = { range: 8.25, halfAngle: Math.PI };
        for (let y = Math.max(0, Math.floor(hiding.y - light.range)); y < Math.min(height, hiding.y + light.range); y += 1) {
          for (let x = Math.max(0, Math.floor(hiding.x - light.range)); x < Math.min(width, hiding.x + light.range); x += 1) {
            const tile = core.tileAt(x, y, width);
            if (floor.tiles[tile] !== 0 || floor.roomsByTile[tile] !== -1 || floor.doorways[tile]) continue;
            assert.equal(core.seesTarget(floor.tiles, { x: x + 0.5, y: y + 0.5, angle: 0 }, hiding, light, width), false);
          }
        }
        const objects = floor.furniture.filter(object => floor.roomsByTile[core.tileAt(object.x, object.y, width)] === room.id);
        if (room.lounge) {
          lounges += 1;
          assert.ok(itemsByRoom.has(room.id));
          assert.ok(area >= 30 && area <= 42);
          assert.ok(objects.some(object => object.kind === 'sofa'));
          assert.ok(objects.every(object => object.kind !== 'bunk' && object.kind !== 'wardrobe'));
        } else {
          if (room.id !== floor.homeRoomId) {
            bedrooms += 1;
            if (itemsByRoom.has(room.id)) bedroomItems += 1;
          }
          assert.ok(area >= 20 && area <= 25);
          assert.equal(objects.filter(object => object.kind === 'bunk').length, 1);
          assert.equal(objects.filter(object => object.kind === 'wardrobe').length, 1);
          assert.ok(objects.length >= 4);
        }
      }
      assert.ok(floor.lookouts.size > 0);
      assert.equal(floor.guards.length, [0, 4, 3, 3, 2, 1][number]);
      const spawns = new Set();
      for (const guard of floor.guards) {
        const spawn = core.tileAt(guard.x, guard.y, width);
        assert.ok(distance[spawn] >= 12);
        assert.equal(floor.roomsByTile[spawn], -1);
        assert.equal(guard.previousPatrolTile, spawn);
        assert.ok(floor.patrolLinks.get(spawn).has(guard.patrolTile));
        spawns.add(spawn);
      }
      assert.equal(spawns.size, floor.guards.length);
    }
  }
  assert.deepEqual(kinds, new Set(['straight', 'dogleg', 'loop']));
  assert.ok(Math.abs(lounges / 1600 - 0.33) < 0.05);
  assert.ok(Math.abs(bedroomItems / bedrooms - 0.18) < 0.02);
  assert.deepEqual(itemIds, new Set(Object.keys(items)));
  assert.deepEqual(core.createFloor(5, 1).tiles, core.createFloor(5, 1).tiles);
  assert.deepEqual(core.createFloor(4, 3).pickups, core.createFloor(4, 3).pickups);
  assert.deepEqual(core.createFloor(1, 3).cameras, core.createFloor(1, 3).cameras);
  assert.notDeepEqual(core.createFloor(5, 1).tiles, core.createFloor(5, 2).tiles);
});

test('each layout has two separate approaches to the stairs and a connected patrol network', () => {
  for (const kind of map.LAYOUTS) {
    for (let seed = 0; seed < 80; seed += 1) {
      for (let number = 5; number >= 1; number -= 1) {
        const { width, routes: [main, bypass], tiles, spawnTile, goalTile, goalTiles, upTile, patrolLinks, roomsByTile } =
          core.createFloor(number, seed, kind);
        for (const [stair, targets, start] of [[goalTile, goalTiles, spawnTile], [upTile, [upTile], goalTile]]) {
          if (stair === null) continue;
          const fromEnd = stair === main[0] ? 2 : -3;
          const mainApproach = main.at(fromEnd);
          const sideApproach = bypass.at(fromEnd);
          assert.equal(Math.abs(mainApproach - stair), 2);
          assert.equal(Math.abs(sideApproach - stair), 2 * width);

          const mainCut = [mainApproach - width, mainApproach, mainApproach + width];
          const sideCut = [sideApproach, sideApproach + 1];
          for (const cut of [mainCut, sideCut]) {
            const blocked = tiles.slice();
            for (const tile of cut) blocked[tile] = map.WALL;
            const { distance } = core.walkableTiles(blocked, start, -1, width);
            assert.ok(targets.some(tile => distance[tile] >= 0), `${kind}, floor ${number}, seed ${seed}`);
          }
        }

        const reached = new Set([patrolLinks.keys().next().value]);
        for (const tile of reached) {
          assert.equal(roomsByTile[tile], -1);
          assert.equal(tiles[tile], 0);
          assert.ok(!goalTiles.includes(tile));
          assert.notEqual(tile, upTile);
          for (const neighbor of patrolLinks.get(tile)) reached.add(neighbor);
        }
        assert.equal(reached.size, patrolLinks.size);
        assert.ok(main.some(tile => reached.has(tile) && !bypass.includes(tile)));
        assert.ok(bypass.some(tile => reached.has(tile) && !main.includes(tile)));
      }
    }
  }
});

test('the fifth-floor guard moves between the main corridor and the bypass', () => {
  for (const kind of map.LAYOUTS) {
    const game = core.createGame(0);
    const floor = core.createFloor(5, 0, kind);
    game.floor = floor;
    const room = floor.rooms.find(room => room.tile === floor.spawnTile);
    Object.assign(game.player, core.tileCenter(room.hidingTile, floor.width));
    const [main, bypass] = floor.routes;
    const [guard] = floor.guards;
    let visitedMain = false;
    let visitedBypass = false;
    for (let frame = 0; frame < 3600 && !(visitedMain && visitedBypass); frame += 1) {
      tick(game, 1);
      assert.equal(guard.mode, 'patrol');
      const tile = core.tileAt(guard.x, guard.y, floor.width);
      visitedMain ||= main.includes(tile) && !bypass.includes(tile);
      visitedBypass ||= bypass.includes(tile) && !main.includes(tile);
    }
    assert.ok(visitedMain && visitedBypass, kind);
  }
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

test('solid furniture stops movement and guard light while the player can light the room beyond it', () => {
  const game = openFloor();
  const { tiles } = game.floor;
  const player = game.player;
  Object.assign(player, { x: 5.5, y: 5.5, angle: 0 });
  tiles[core.tileAt(6, 5)] = map.FURNITURE;
  assert.equal(core.seesTarget(tiles, player, { x: 7.5, y: 5.5 }, core.PLAYER_LIGHT), true);
  tick(game, 60, { x: 1, y: 0 });
  assert.ok(player.x <= 6 - core.PLAYER_RADIUS);

  const guard = core.createFloor(5, 0).guards[0];
  Object.assign(guard, { x: 4.5, y: 5.5, angle: 0, targetAngle: 0, lookTime: 1 });
  game.floor.guards = [guard];
  Object.assign(player, { x: 8.5, y: 5.5 });
  assert.equal(core.seesTarget(tiles, guard, player, core.guardLight(guard)), false);
  assert.equal(core.seesTarget(tiles, guard, player, core.guardLight({ mode: 'chase' })), false);
  tick(game, 50);
  assert.equal(guard.noticeTime, 0);
  assert.equal(guard.mode, 'patrol');
  tiles[core.tileAt(6, 5)] = 0;
  tick(game, 1);
  assert.ok(guard.noticeTime > 0);
  tick(game, 44);
  assert.equal(guard.mode, 'chase');
  tiles[core.tileAt(6, 5)] = map.FURNITURE;
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
  assert.ok(Math.abs(game.player.stamina - 2) < 1e-8);
  tick(game, 45);
  assert.ok(Math.abs(game.player.stamina - 2) < 1e-8);
  assert.equal(game.player.recovering, false);
  tick(game, 119);
  assert.ok(game.player.stamina < 4);
  assert.equal(game.player.recovering, true);
  tick(game, 1);
  assert.equal(game.player.stamina, 4);
  assert.equal(game.player.staminaRestoredAt, game.time);
  tick(game, 1);
  assert.equal(game.player.recovering, false);
});

test('exhaustion slows walking and prevents sprinting until a full seven-second recovery', () => {
  const game = openFloor();
  Object.assign(game.player, { x: 3.5, y: 11.5 });
  const sprint = { x: 1, y: 0, sprint: true };
  tick(game, 239, sprint);
  assert.equal(game.player.exhausted, false);
  tick(game, 1, sprint);
  assert.ok(Math.abs(game.player.x - 23.5) < 1e-8);
  assert.equal(game.player.stamina, 0);
  assert.equal(game.player.sprintLocked, true);
  assert.equal(game.player.exhausted, true);

  tick(game, 45, { ...IDLE, sprint: true });
  assert.ok(game.player.stamina < 1e-8);
  tick(game, 240, { ...IDLE, sprint: true });
  assert.ok(game.player.stamina < 4);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 25.3) < 1e-8);
  tick(game, 119, { ...IDLE, sprint: true });
  assert.equal(game.player.exhausted, true);
  tick(game, 1, { ...IDLE, sprint: true });
  assert.equal(game.player.exhausted, false);
  assert.equal(game.player.stamina, 4);
  assert.equal(game.player.sprintLocked, true);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 28.3) < 1e-8);

  tick(game, 1);
  tick(game, 60, sprint);
  assert.ok(Math.abs(game.player.x - 33.3) < 1e-8);
  assert.ok(Math.abs(game.player.stamina - 3) < 1e-8);
});

test('breaking sight during the 0.75-second warning resets detection', () => {
  const game = openFloor();
  const guard = core.createFloor(5, 0).guards[0];
  Object.assign(guard, { x: 10.5, y: 10.5, angle: 0, targetAngle: 0, lookTime: 1 });
  Object.assign(game.player, { x: 14.5, y: 10.5 });
  game.floor.guards = [guard];

  tick(game, 44);
  assert.equal(guard.mode, 'patrol');
  assert.ok(guard.noticeTime > 0.7);
  const wall = core.tileAt(12, 10);
  game.floor.tiles[wall] = 1;
  tick(game, 1);
  assert.equal(guard.noticeTime, 0);
  game.floor.tiles[wall] = 0;

  tick(game, 44);
  assert.equal(guard.mode, 'patrol');
  tick(game, 1);
  assert.equal(guard.mode, 'chase');
  assert.equal(guard.noticeTime, 0);
});

test('CCTV cannot see through walls and alerts the closest guard the instant the player touches its sweep', () => {
  const game = openFloor();
  const { floor, player } = game;
  const camera = { x: 6.5, y: 8.5, heading: 0, phase: 0 };
  floor.cameras = [camera];
  const [near, far] = core.createFloor(4, 0).guards;
  for (const [guard, x] of [[near, 12.5], [far, 19.5]]) {
    Object.assign(guard, { x, y: 8.5, angle: 0, lookTime: 10 });
  }
  floor.guards = [far, near];
  Object.assign(player, { x: 9.5, y: 8.5 });
  const wall = core.tileAt(8, 8);
  floor.tiles[wall] = map.WALL;
  tick(game, 1);
  assert.equal(near.mode, 'patrol');
  assert.equal(game.alertCamera, null);

  floor.tiles[wall] = 0;
  const angle = core.cameraAngle(camera, game.time + STEP);
  const edge = angle + core.CAMERA_SCAN.halfAngle + 0.07;
  Object.assign(player, { x: camera.x + 3 * Math.cos(edge), y: camera.y + 3 * Math.sin(edge) });
  assert.equal(core.seesTarget(floor.tiles, { ...camera, angle }, player, core.CAMERA_SCAN), false);
  tick(game, 1);
  assert.equal(game.alertCamera, camera);
  assert.equal(near.mode, 'chase');
  assert.deepEqual(near.lastSeen, { x: player.x, y: player.y });
  assert.equal(far.mode, 'patrol');
  assert.notEqual(core.cameraAngle(camera, 1), core.cameraAngle(camera, 0));
});

test('sight expands on detection and each guard clears its alert after 2.5 continuous seconds', () => {
  const game = openFloor();
  const [first, second] = core.createFloor(1, 0).guards;
  Object.assign(first, { x: 10.5, y: 10.5, angle: 0 });
  Object.assign(second, { x: 30.5, y: 23.5, angle: 0, lookTime: 10 });
  game.floor.guards = [first, second];

  Object.assign(game.player, { x: 14.5, y: 10.5 });
  assert.equal(core.guardLight(first).range, 6.5);
  tick(game, 45);
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
  const route = setPatrolHall(game.floor, 10, 12, 10);
  const waypoint = route[1];
  Object.assign(game.player, { x: 30.5, y: 25.5 });
  Object.assign(guard, {
    ...core.tileCenter(route[0]),
    angle: 0, previousPatrolTile: route[0], patrolTile: waypoint,
    path: [core.tileCenter(waypoint)], pathIndex: 0, lookCooldown: 0,
  });
  game.floor.guards = [guard];
  game.floor.lookouts.set(waypoint, [core.tileAt(11, 13)]);
  game.floor.random = () => 0;

  tick(game, 28);
  assert.equal(guard.mode, 'patrol');
  assert.ok(guard.angle > 0 && guard.angle < Math.PI / 2);
  assert.ok(guard.lookTime > 0);
  assert.equal(guard.x, 11.5);
  tick(game, 20);
  assert.ok(Math.abs(guard.angle - Math.PI / 2) < 1e-8);
  assert.equal(guard.x, 11.5);
});

test('a guard takes the short arc when its heading crosses the angle boundary', () => {
  const game = openFloor();
  const guard = core.createFloor(5, 1).guards[0];
  const angle = Math.PI - 0.055;
  Object.assign(guard, {
    x: 10.5, y: 10.5, angle, targetAngle: angle,
    path: [{ x: 9.5, y: 10.4 }], pathIndex: 0,
  });
  Object.assign(game.player, { x: 30.5, y: 25.5 });
  game.floor.guards = [guard];

  tick(game, 1);
  assert.ok(guard.angle > Math.PI && Math.abs(guard.angle - angle - 0.07) < 1e-8);
  tick(game, 2);
  assert.ok(Math.abs(Math.sin(guard.angle) - Math.sin(guard.targetAngle)) < 1e-8);
});

test('guards turn away from each other on a shared patrol route', () => {
  const game = openFloor();
  const route = setPatrolHall(game.floor, 8, 20, 10);
  const guards = core.createFloor(4, 0).guards;
  const [first, second] = guards;
  Object.assign(game.player, { x: 30.5, y: 25.5 });
  Object.assign(first, { x: 10.5, y: 10.5, angle: 0, previousPatrolTile: route[2], patrolTile: route[3] });
  Object.assign(second, { x: 15.5, y: 10.5, angle: Math.PI, previousPatrolTile: route[7], patrolTile: route[6] });
  for (const guard of guards) {
    Object.assign(guard, { path: [core.tileCenter(guard.patrolTile)], pathIndex: 0 });
  }
  game.floor.guards = guards;

  let nearest = Infinity;
  for (let frame = 0; frame < 100; frame += 1) {
    tick(game, 1);
    nearest = Math.min(nearest, second.x - first.x);
  }
  assert.ok(nearest >= 2.5 - 1e-8 && nearest < 2.6);
  assert.ok(second.x - first.x > 5);
});

test('pursuing guards keep from overlapping and can still catch the player', () => {
  const game = openFloor();
  const [first, second] = core.createFloor(4, 0).guards;
  const target = { x: 18.5, y: 9.5 };
  Object.assign(game.player, target);
  Object.assign(first, { x: 10.5, y: 9.5, angle: 0, mode: 'chase', lastSeen: target });
  Object.assign(second, { x: 9.5, y: 9.5, angle: 0, mode: 'chase', lastSeen: target });
  game.floor.guards = [first, second];

  for (let frame = 0; frame < 150 && game.phase === 'playing'; frame += 1) {
    tick(game, 1);
    assert.ok(first.x - second.x >= 0.8 - 1e-8);
  }
  assert.equal(game.phase, 'caught');
  assert.ok(second.x > 16);
});

test('a guard returning from a room rejoins the shared patrol network', () => {
  const game = openFloor();
  Object.assign(game.player, { x: 30.5, y: 22.5 });
  const [guard] = core.createFloor(5, 0).guards;
  const hall = setPatrolHall(game.floor, 8, 20, 10);
  Object.assign(guard, { x: 13.5, y: 14.5, mode: 'search', unseenTime: 2.49 });
  game.floor.guards = [guard];

  tick(game, 1);
  assert.equal(guard.pathTarget, core.tileAt(13, 10));
  tick(game, 180);
  assert.ok(hall.includes(core.tileAt(guard.x, guard.y)));
  assert.ok(Math.abs(guard.x - 13.5) > 2);
  assert.equal(guard.mode, 'patrol');
  assert.equal(guard.pathTarget, -1);
});

test('stairs preserve visited floors, and either side of the upward stair remains walkable', () => {
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
  assert.equal(previousFloor.guards[0].mode, 'patrol');

  const lower = game.floor;
  const landing = core.tileCenter(lower.spawnTile, lower.width);
  assert.equal(Math.abs(lower.spawnTile - lower.upTile), 1);
  assert.equal(game.player.x, landing.x);
  assert.equal(game.player.y, landing.y);
  tick(game, 1);
  assert.equal(game.floor, lower);
  const towardStair = Math.sign(lower.upTile - lower.spawnTile);
  for (const side of [-lower.width, lower.width]) {
    Object.assign(game.player, core.tileCenter(lower.spawnTile + side, lower.width));
    tick(game, 70, { ...IDLE, x: towardStair });
    assert.equal(game.floor, lower);
    assert.equal(core.tileAt(game.player.x, game.player.y, lower.width), lower.upTile + towardStair + side);
  }
  Object.assign(game.player, landing);
  tick(game, 24, { ...IDLE, x: towardStair });
  assert.equal(game.floor, previousFloor);
  const [main] = previousFloor.routes;
  const upperLanding = previousFloor.goalTile === main[0] ? main[1] : main.at(-2);
  assert.equal(core.tileAt(game.player.x, game.player.y, previousFloor.width), upperLanding);
  assert.ok(!previousFloor.goalTiles.includes(upperLanding));

  Object.assign(lower.guards[0], landing);
  Object.assign(game.player, core.tileCenter(previousFloor.goalTile, previousFloor.width));
  tick(game, 1);
  assert.equal(game.floor, lower);
  assert.equal(core.tileAt(game.player.x, game.player.y, lower.width), lower.spawnTile - lower.width);
});

test('a wider loop floor places the upward stair far from the downward stair', () => {
  const game = core.createGame(63);
  Object.assign(game.player, core.tileCenter(game.floor.goalTile));
  tick(game, 1);

  const { floor } = game;
  assert.equal(floor.number, 4);
  assert.equal(floor.kind, 'loop');
  const { distance } = core.walkableTiles(floor.tiles, floor.spawnTile, -1, floor.width);
  assert.ok(distance[floor.goalTile] >= 26);
  assert.equal(Math.abs(floor.spawnTile - floor.upTile), 1);
});

test('the first floor can return upstairs and a new run has fresh floors', () => {
  const game = core.createGame(0);
  for (let number = 5; number > 1; number -= 1) {
    const { width, goalTile } = game.floor;
    Object.assign(game.player, core.tileCenter(goalTile, width));
    tick(game, 1);
  }
  const ground = game.floor;
  assert.equal(ground.number, 1);
  Object.assign(game.player, core.tileCenter(ground.upTile, ground.width));
  tick(game, 1);
  assert.equal(game.floor.number, 2);
  assert.equal(game.phase, 'playing');
  assert.notEqual(core.createGame(0).floor, game.floors.get(5));
});

test('guards patrol and pursue progressively faster on the bottom three floors', () => {
  const top = core.createFloor(5, 0);
  const fourth = core.createFloor(4, 0);
  assert.equal(top.patrolSpeed, fourth.patrolSpeed);
  assert.equal(top.chaseSpeed, fourth.chaseSpeed);
  let previous = fourth;
  for (let number = 3; number >= 1; number -= 1) {
    const floor = core.createFloor(number, 0);
    assert.ok(floor.patrolSpeed > previous.patrolSpeed);
    assert.ok(floor.chaseSpeed > previous.chaseSpeed && floor.chaseSpeed < 5);
    previous = floor;
  }
});

test('waiting for patrols and taking side passages can clear all five floors without setting off a chase', () => {
  // One seed with a keyboard route of up, down, left, right and wait, one tile per symbol.
  const routes = [
    'UUUULLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLDDDL',
    'URRRRRRRRRRRRRRRRRRRRUR...U.R..LDDRRRRRRRUUUUUUUUUUUURRRRRRRRR',
    'UUUDDDDRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRDDDUDURUUURRRRRRRRRRRRR',
    'UDUDUDUDUDUDUDUDUDUDUDUDUDUDUDUDUDUDDRRRRRRRRRRRRRRRRRRRRRRRRRRRRDDDDDDUDDDDDRRRRRRRRRRRRRRRRRRRDDDDDDDDDRDRRRRR',
    'UDUDUDDLLLLLLLLLLDUUUUUUUUUUUUUUUUUUUUUUUUUUUDULLLL.LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL',
  ];
  const movements = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], '.': [0, 0] };
  const game = core.createGame(0);
  const kinds = new Set();
  for (const [index, route] of routes.entries()) {
    const floor = game.floor;
    assert.equal(floor.number, 5 - index);
    kinds.add(floor.kind);
    const [main, bypass] = floor.routes;
    const approach = (index === 0 ? bypass : main).at(floor.goalTile === main[0] ? 2 : -3);
    const approachTiles = index === 0 ? [approach, approach + 1] :
      [approach - floor.width, approach, approach + floor.width];
    let usedApproach = false;
    for (const action of route) {
      const [x, y] = movements[action];
      for (let frame = 0; frame < 20 && game.floor === floor && game.phase === 'playing'; frame += 1) {
        core.step(game, {x, y, sprint: false}, STEP);
        assert.ok(floor.guards.every(guard => guard.mode === 'patrol' && guard.noticeTime === 0));
        usedApproach ||= game.floor === floor && approachTiles.includes(core.tileAt(game.player.x, game.player.y, floor.width));
      }
    }
    assert.ok(usedApproach, `floor ${floor.number}`);
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
  assert.equal(retry.player.stamina, 4);
  assert.notDeepEqual(retry.floor.tiles, originalTiles);
});

test('entering the home room clears pursuit and guards can only detect or catch outside it', () => {
  const game = core.createGame(53);
  const { floor, player } = game;
  const [guard] = floor.guards;
  const { hall, wall, inside } = floor.rooms[floor.homeRoomId].entrance;
  const doorway = core.tileCenter(wall[0], floor.width);
  const interior = core.tileCenter(inside[0], floor.width);
  const x = interior.x - doorway.x;
  const y = interior.y - doorway.y;

  Object.assign(player, { x: doorway.x + x * 0.48, y: doorway.y + y * 0.48 });
  Object.assign(guard, {
    x: interior.x - x * 0.3, y: interior.y - y * 0.3,
    mode: 'chase', lastSeen: { x: player.x, y: player.y },
  });
  tick(game, 1, { x, y });
  assert.equal(core.tileAt(player.x, player.y, floor.width), inside[0]);
  assert.equal(game.phase, 'playing');
  assert.equal(guard.mode, 'patrol');

  Object.assign(guard, { x: player.x, y: player.y, noticeTime: 0.74, lookTime: 2 });
  tick(game, 50);
  assert.equal(game.phase, 'playing');
  assert.equal(guard.mode, 'patrol');
  assert.equal(guard.noticeTime, 0);

  Object.assign(player, doorway);
  const outside = core.tileCenter(hall[0], floor.width);
  Object.assign(guard, outside, { angle: Math.atan2(y, x), targetAngle: Math.atan2(y, x), lookTime: 1 });
  tick(game, 1);
  assert.ok(guard.noticeTime > 0);
  Object.assign(player, outside);
  tick(game, 1);
  assert.equal(game.phase, 'caught');
});

test('pickup is limited by reach and furniture and swaps only the matching inventory slot', () => {
  const game = openFloor();
  const { floor, player, inventory } = game;
  const pickup = { ...IDLE, interact: true };
  Object.assign(player, { x: 5.5, y: 8.5 });
  const far = { id: 'reagent', x: 7.5, y: 8.5 };
  floor.pickups.push(far);
  tick(game, 1, pickup);
  assert.equal(inventory.active, null);

  const nightVision = { id: 'nightVision', x: 6.5, y: 8.5 };
  floor.pickups.push(nightVision);
  const blockingTile = core.tileAt(6, 8);
  floor.tiles[blockingTile] = map.FURNITURE;
  tick(game, 1, pickup);
  assert.equal(inventory.passive, null);
  floor.tiles[blockingTile] = 0;
  tick(game, 1, pickup);
  assert.equal(inventory.passive.id, 'nightVision');
  assert.deepEqual(floor.pickups, [far]);

  floor.pickups.push({ id: 'emp', x: 5.5, y: 7.5 }, { id: 'bread', x: 4.5, y: 8.5 });
  tick(game, 1, pickup);
  assert.equal(inventory.active.id, 'emp');
  tick(game, 1, pickup);
  assert.equal(inventory.active.id, 'emp');
  assert.equal(inventory.passive.id, 'bread');
  assert.deepEqual(floor.pickups, [far, { id: 'nightVision', x: 4.5, y: 8.5 }]);
  player.x = 7;
  tick(game, 1, pickup);
  assert.equal(inventory.active.id, 'reagent');
  assert.deepEqual(floor.pickups[0], { ...far, id: 'emp' });
  tick(game, 180);
  assert.equal(game.dismissedPickup, far);
  assert.equal(core.nearbyItem(game).id, 'emp');
  player.x = 9;
  tick(game, 1);
  assert.equal(game.dismissedPickup, null);
  assert.equal(core.createGame(0).inventory.active, null);
});

test('one interaction picks up a reachable item before using the held active item', () => {
  const game = openFloor();
  const { floor, player, inventory } = game;
  Object.assign(player, { x: 5.5, y: 8.5, stamina: 2 });
  inventory.active = { id: 'monster' };
  floor.pickups.push({ id: 'nightVision', x: 6.5, y: 8.5 });
  const interact = { ...IDLE, interact: true };

  tick(game, 1, interact);
  assert.equal(inventory.passive.id, 'nightVision');
  assert.equal(inventory.active.id, 'monster');
  assert.equal(player.stamina, 2);
  assert.equal(game.itemEffects.size, 0);
  assert.deepEqual(floor.pickups, []);

  tick(game, 1, interact);
  assert.equal(inventory.active, null);
  assert.equal(player.stamina, 4);
  assert.ok(game.itemEffects.has('monster:speed'));
});

test('night vision lights behind the player at the normal range and walls still block it', () => {
  const game = openFloor();
  const { floor, player } = game;
  Object.assign(player, { x: 9.5, y: 8.5, angle: 0 });
  const behind = { x: 5.5, y: 8.5 };
  assert.equal(core.seesTarget(floor.tiles, player, behind, core.playerLight(game)), false);
  game.inventory.passive = { id: 'nightVision' };
  const light = core.playerLight(game);
  assert.equal(light.range, core.PLAYER_LIGHT.range);
  assert.equal(core.seesTarget(floor.tiles, player, behind, light), true);
  floor.tiles[core.tileAt(8, 8)] = map.WALL;
  assert.equal(core.seesTarget(floor.tiles, player, behind, light), false);
});

test('sneakers add half a second of stamina and 10% sprint speed, with consistent stamina on swap', () => {
  const game = openFloor();
  const { floor, player } = game;
  Object.assign(player, { x: 5.5, y: 8.5 });
  floor.pickups.push({ id: 'sneakers', x: 5.5, y: 8.5 });
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(core.maxStamina(game), 4.5);
  assert.equal(player.stamina, 4.5);
  assert.equal(core.heldItem(game).pickedUpAt, game.time);
  assert.equal(player.speedBoosted, false);
  tick(game, 60, { x: 1, y: 0, sprint: true });
  assert.equal(player.speedBoosted, true);
  assert.ok(Math.abs(player.x - 11) < 1e-8);
  assert.ok(Math.abs(player.stamina - 3.5) < 1e-8);
  floor.pickups.push({ id: 'bread', x: 11, y: 8.5 });
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(core.maxStamina(game), 4);
  assert.equal(player.speedBoosted, false);
  assert.ok(Math.abs(player.stamina / 4 - 3.5 / 4.5) < 1e-8);
});

test('Monster restores stamina and increases movement for exactly seven seconds', () => {
  const game = openFloor();
  const { player } = game;
  Object.assign(player, { x: 4.5, y: 8.5, stamina: 0.8, exhausted: true, sprintLocked: true });
  game.inventory.active = { id: 'monster' };
  tick(game, 1, { x: 1, y: 0, interact: true });
  assert.equal(game.inventory.active, null);
  assert.equal(player.stamina, 4);
  assert.equal(player.exhausted, false);
  assert.equal(player.sprintLocked, false);
  assert.equal(player.staminaRestoredAt, game.time);
  assert.equal(player.speedBoosted, true);
  assert.equal(game.itemEffects.get('monster:speed').until, player.speedBoostUntil);
  assert.ok(Math.abs(player.x - (4.5 + 4.5 * STEP)) < 1e-8);
  tick(game, 418);
  tick(game, 1, { x: 1, y: 0 });
  assert.ok(Math.abs(player.x - (4.5 + 9 * STEP)) < 1e-8);
  tick(game, 1, { x: 1, y: 0 });
  assert.ok(Math.abs(player.x - (4.5 + 12 * STEP)) < 1e-8);
  assert.equal(player.speedBoosted, false);
  assert.equal(game.itemEffects.size, 0);
});

test('the two reagent rolls exhaust immediately or prevent stamina drain for five seconds', () => {
  const game = openFloor();
  const { player, inventory } = game;
  Object.assign(player, { x: 4.5, y: 8.5 });
  game.itemRandom = () => 0.5;
  inventory.active = { id: 'reagent' };
  tick(game, 1, { x: 1, y: 0, sprint: true, interact: true });
  assert.equal(game.itemEffects.get('reagent:freeSprint').until, player.freeSprintUntil);
  tick(game, 299, { x: 1, y: 0, sprint: true });
  assert.equal(inventory.active, null);
  assert.equal(player.stamina, 4);
  assert.ok(Math.abs(player.x - 29.5) < 1e-8);
  tick(game, 1, { x: 1, y: 0, sprint: true });
  assert.ok(player.stamina < 4);

  game.itemRandom = () => 0.49;
  inventory.active = { id: 'reagent' };
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(inventory.active, null);
  assert.equal(player.stamina, 0);
  assert.equal(player.exhausted, true);
  assert.equal(game.itemEffects.get('reagent:exhausted').timed, false);
});

test('the BB gun is kept before detection and ends pursuit while stunning the nearest pursuer for three seconds', () => {
  const game = openFloor();
  const { floor, player, inventory } = game;
  setPatrolHall(floor, 8, 25, 10);
  const [near, far] = core.createFloor(4, 0).guards;
  Object.assign(player, { x: 14.5, y: 10.5 });
  Object.assign(near, { x: 10.5, y: 10.5, angle: 0 });
  Object.assign(far, { x: 22.5, y: 10.5, angle: Math.PI });
  floor.guards = [near, far];
  inventory.active = { id: 'bbGun' };
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(inventory.active.id, 'bbGun');
  assert.equal(game.shot, null);
  assert.equal(game.itemEffects.size, 0);
  Object.assign(near, { mode: 'chase', noticeTime: 0 });
  Object.assign(far, { mode: 'search', noticeTime: 0 });

  const location = { x: near.x, y: near.y, angle: near.angle };
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(inventory.active, null);
  assert.ok(floor.guards.every(guard => guard.mode === 'patrol' && guard.noticeTime === 0));
  assert.deepEqual(game.shot.to, { x: location.x, y: location.y });
  assert.equal(far.stunnedUntil, 0);
  assert.equal(game.itemEffects.get('bbGun:stun').until, near.stunnedUntil);
  assert.equal(game.itemEffects.get('bbGun:stun').floorNumber, floor.number);
  Object.assign(player, { x: 35.5, y: 25.5 });
  tick(game, 179);
  assert.deepEqual({ x: near.x, y: near.y, angle: near.angle }, location);
  tick(game, 1);
  assert.notEqual(near.x, location.x);
});

test('EMP clears detection and disables every guard light on the current floor for four seconds', () => {
  const game = openFloor();
  const { floor, player, inventory } = game;
  setPatrolHall(floor, 8, 25, 10);
  const [near, far] = core.createFloor(4, 0).guards;
  Object.assign(player, { x: 14.5, y: 10.5 });
  floor.cameras = [{ x: 13.5, y: 10.5, heading: 0, phase: 0 }];
  assert.equal(core.cameraSeesPlayer(floor, floor.cameras[0], player, game.time + STEP), true);
  Object.assign(near, { x: 14.5, y: 10.5, angle: 0, mode: 'chase' });
  Object.assign(far, { x: 22.5, y: 10.5, angle: Math.PI, noticeTime: 0.6, lookTime: 10 });
  floor.guards = [near, far];
  inventory.active = { id: 'emp' };
  const otherFloor = core.createFloor(4, 0);
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(game.phase, 'playing');
  assert.equal(game.alertCamera, null);
  assert.equal(inventory.active, null);
  assert.ok(floor.guards.every(guard => guard.mode === 'patrol' && guard.noticeTime === 0));
  assert.ok(otherFloor.guards.every(guard => core.guardLight(guard, otherFloor, game.time)));
  assert.equal(game.itemEffects.get('emp:blackout').until, floor.empUntil);
  assert.equal(game.itemEffects.get('emp:blackout').floorNumber, floor.number);
  Object.assign(player, { x: 35.5, y: 25.5 });
  tick(game, 239);
  assert.ok(floor.guards.every(guard => !core.guardLight(guard, floor, game.time) && guard.noticeTime === 0));
  tick(game, 1);
  assert.ok(floor.guards.every(guard => core.guardLight(guard, floor, game.time)));
});

test('AI glasses guide to the nearest reachable down-stair tile on their pickup floor and disappear on descent', () => {
  const game = core.createGame(1);
  const upper = game.floor;
  Object.assign(game.player, core.tileCenter(upper.goalTile, upper.width));
  tick(game, 1);
  const floor = game.floor;
  floor.pickups = [{ id: 'aiGlasses', x: game.player.x, y: game.player.y }];
  tick(game, 1, { ...IDLE, interact: true });
  assert.equal(game.inventory.passive.floorNumber, 4);
  const route = core.itemRoute(game);
  const tiles = route.map(({ x, y }) => core.tileAt(x, y, floor.width));
  const walkable = floor.tiles.slice();
  walkable[floor.upTile] = map.WALL;
  const { distance } = core.walkableTiles(walkable, tiles[0], -1, floor.width);
  assert.equal(tiles[0], core.tileAt(game.player.x, game.player.y, floor.width));
  assert.ok(floor.goalTiles.includes(tiles.at(-1)));
  assert.equal(tiles.length - 1, Math.min(...floor.goalTiles.map(tile => distance[tile]).filter(steps => steps >= 0)));
  assert.ok(tiles.every((tile, index) => walkable[tile] === 0 &&
    (!index || [1, floor.width].includes(Math.abs(tile - tiles[index - 1])))));

  Object.assign(game.player, core.tileCenter(floor.upTile, floor.width));
  tick(game, 1);
  assert.equal(game.floor, upper);
  assert.equal(game.inventory.passive.id, 'aiGlasses');
  assert.deepEqual(core.itemRoute(game), []);
  assert.equal(core.heldItem(game), null);
  Object.assign(game.player, core.tileCenter(upper.goalTile, upper.width));
  tick(game, 1);
  assert.equal(game.floor, floor);
  assert.equal(game.inventory.passive, null);
  assert.deepEqual(core.itemRoute(game), []);
  assert.equal(game.itemEffects.get('aiGlasses:spent').timed, false);
});

test('bread marks actual movement at regular intervals and its trail persists on a visited floor', () => {
  const game = openFloor();
  const { floor, player } = game;
  floor.goalTile = floor.routes[0][0];
  floor.goalTiles = [floor.goalTile];
  Object.assign(player, { x: 12.5, y: 8.5 });
  game.inventory.passive = { id: 'bread' };
  tick(game, 30);
  assert.equal(floor.crumbs.size, 0);
  tick(game, 62, { x: -1, y: 0 });
  const crumbs = [...floor.crumbs.values()];
  assert.equal(crumbs.length, 4);
  crumbs.forEach(({ x, y }, index) => {
    assert.ok(Math.abs(x - (12.5 - (index + 1) * 0.75)) < 1e-8);
    assert.equal(y, 8.5);
  });
  Object.assign(player, core.tileCenter(floor.goalTile, floor.width));
  tick(game, 1);
  assert.equal(game.floor.crumbs.size, 0);
  assert.equal(game.inventory.passive.id, 'bread');
  Object.assign(player, core.tileCenter(game.floor.upTile, game.floor.width));
  tick(game, 1);
  assert.equal(game.floor, floor);
  assert.deepEqual([...floor.crumbs.values()], crumbs);
});
