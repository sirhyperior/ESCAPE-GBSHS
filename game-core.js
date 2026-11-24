(function (root) {
  'use strict';

  const map = typeof module === 'object' && module.exports ? require('./game-map.js') : root.DormMap;
  const items = typeof module === 'object' && module.exports ? require('./game-items.js') : root.DormItems;
  const {
    WIDTH, HEIGHT, WALL, LAYOUTS, randomSource, choose, shuffle, tileAt, tileCenter,
    isWall, isSolid, walkableTiles, createLayout, placeRoomItems, cameraMounts,
  } = map;
  const MIN_ROUTE = 26;
  const MIN_GUARD_DISTANCE = 12;
  const GUARD_SPAWN_SPACING = 7;
  const STAIR_PATROL_CLEARANCE = 3;
  const GUARD_COUNTS = [0, 4, 3, 3, 2, 1];
  const CAMERA_COUNTS = [0, 6, 4, 2, 0, 0];
  const PLAYER_RADIUS = 0.25;
  const GUARD_RADIUS = 0.24;
  const WALK_SPEED = 3;
  const EXHAUSTED_SPEED = 1.8;
  const RUN_SPEED = 5;
  const PATROL_SPEED = 2.35;
  const CHASE_SPEED = 3.7;
  const PATROL_TURN_SPEED = 4.2;
  const CHASE_TURN_SPEED = 6.5;
  const PATROL_SPACING = 2.5;
  const PURSUIT_SPACING = 0.8;
  const NOTICE_TIME = 0.75;
  const MAX_STAMINA = 4;
  const SNEAKER_STAMINA = 0.5;
  const RECOVERY_DELAY = 0.75;
  const SEARCH_TIME = 2.5;
  const EPSILON = 1e-9;
  const ITEM_IDS = Object.keys(items);
  const ITEM_REACH = { range: 1.25, halfAngle: Math.PI, blocked: isSolid };
  const CRUMB_SPACING = 0.75;
  const SHOT_DURATION = 0.38;
  const PLAYER_LIGHT = Object.freeze({ range: 5, halfAngle: 55 * Math.PI / 180 });
  const NIGHT_VISION_LIGHT = Object.freeze({ ...PLAYER_LIGHT, halfAngle: Math.PI });
  const PATROL_LIGHT = Object.freeze({ range: 6.5, halfAngle: 55 * Math.PI / 180, blocked: isSolid });
  const CHASE_LIGHT = Object.freeze({ range: 8.25, halfAngle: 70 * Math.PI / 180, blocked: isSolid });
  const CAMERA_SCAN = Object.freeze({ range: 3.8, halfAngle: Math.PI / 11, blocked: isSolid });
  const CAMERA_SWEEP = 0.57;
  const CAMERA_TURN_RATE = 2 * Math.PI / 6.8;

  function cameraAngle(camera, time) {
    return camera.heading + CAMERA_SWEEP * Math.sin(camera.phase + time * CAMERA_TURN_RATE);
  }

  function cameraSweepTiles(floor, camera) {
    const { tiles, width } = floor;
    // Each point between neighboring tile centers is at most half a tile from one of them.
    const margin = 0.5 + PLAYER_RADIUS;
    const reach = CAMERA_SCAN.range + margin;
    const swept = [];
    for (let y = Math.floor(camera.y - reach); y <= Math.floor(camera.y + reach); y += 1) {
      for (let x = Math.floor(camera.x - reach); x <= Math.floor(camera.x + reach); x += 1) {
        if (isSolid(tiles, x, y, width)) continue;
        const dx = x + 0.5 - camera.x;
        const dy = y + 0.5 - camera.y;
        const distance = Math.hypot(dx, dy);
        if (distance > reach) continue;
        const difference = Math.atan2(dy, dx) - camera.heading;
        const offset = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
        if (distance <= margin || offset <= CAMERA_SWEEP + CAMERA_SCAN.halfAngle + Math.asin(margin / distance)) {
          swept.push(tileAt(x, y, width));
        }
      }
    }
    return swept;
  }

  function placeCameras(floor, random) {
    const count = CAMERA_COUNTS[floor.number];
    if (!count) return [];
    const { tiles, width, spawnTile, upTile, goalTile, goalTiles } = floor;
    const stairs = [upTile, goalTile].map(tile => tileCenter(tile, width));
    const open = tiles.slice();
    open[upTile] = WALL;
    const cameras = [];
    for (const mount of shuffle(cameraMounts(floor), random)) {
      if (stairs.some(stair => Math.hypot(mount.x - stair.x, mount.y - stair.y) < 6)) continue;
      if (cameras.some(camera => Math.hypot(mount.x - camera.x, mount.y - camera.y) < 6)) continue;

      const swept = cameraSweepTiles(floor, mount).filter(tile => open[tile] === 0);
      for (const tile of swept) open[tile] = WALL;
      const { distance } = walkableTiles(open, spawnTile, -1, width);
      if (goalTiles.some(tile => distance[tile] >= 0)) {
        cameras.push({ ...mount, phase: random() * 2 * Math.PI });
        if (cameras.length === count) break;
      } else {
        for (const tile of swept) open[tile] = 0;
      }
    }
    return cameras;
  }

  function corridorLinks(routes, stairTiles, width) {
    const stairs = stairTiles.map(tile => tileCenter(tile, width));
    const links = new Map();
    for (const route of routes) {
      let previous;
      for (const tile of route) {
        const { x, y } = tileCenter(tile, width);
        if (stairs.some(stair => Math.abs(x - stair.x) + Math.abs(y - stair.y) < STAIR_PATROL_CLEARANCE)) {
          previous = undefined;
          continue;
        }
        if (!links.has(tile)) links.set(tile, new Set());
        if (previous !== undefined) {
          links.get(previous).add(tile);
          links.get(tile).add(previous);
        }
        previous = tile;
      }
    }
    return links;
  }

  function stairLanding(main, tile) {
    return tile === main[0] ? main[1] : main.at(-2);
  }

  function doorwayLookouts(rooms, patrolLinks) {
    const lookouts = new Map();
    for (const { entrance } of rooms) {
      for (let index = 0; index < entrance.hall.length; index += 1) {
        const hall = entrance.hall[index];
        const inward = entrance.wall[index] - hall;
        const tile = patrolLinks.has(hall) ? hall : hall - inward;
        if (!patrolLinks.has(tile)) continue;
        if (!lookouts.has(tile)) lookouts.set(tile, []);
        lookouts.get(tile).push(entrance.inside[index]);
      }
    }
    return lookouts;
  }

  function createFloor(number, seed, kind) {
    const random = randomSource(seed);
    const layout = createLayout(random, kind, 5 - number);
    const { tiles, rooms, routes, width } = layout;
    const [main] = routes;
    const bedrooms = rooms.filter(room => !room.lounge);
    const ends = [main[0], main.at(-1)].map(tile => {
      const { distance } = walkableTiles(tiles, tile, -1, width);
      const farthest = Math.max(...bedrooms.map(room => distance[room.tile]));
      return { tile, distance, farthest };
    });
    let goal = choose(ends, random);
    let entry = ends.find(end => end !== goal);
    if (goal.farthest < MIN_ROUTE && entry.farthest > goal.farthest) {
      [goal, entry] = [entry, goal];
    }
    const minimum = Math.min(MIN_ROUTE, goal.farthest);
    const starts = bedrooms.filter(room => goal.distance[room.tile] >= minimum);
    starts.sort((a, b) => entry.distance[a.tile] - entry.distance[b.tile]);
    const bedroomTile = choose(starts.slice(0, 2), random).tile;
    const goalTile = goal.tile;
    const goalTiles = [goalTile - width, goalTile, goalTile + width];
    const upTile = number === 5 ? null : entry.tile;
    const spawnTile = upTile === null ? bedroomTile : stairLanding(main, upTile);
    const homeRoomId = number === 5 ? layout.roomsByTile[spawnTile] : null;
    const patrolLinks = corridorLinks(routes, upTile === null ? [goalTile] : [goalTile, upTile], width);
    const lookouts = doorwayLookouts(rooms, patrolLinks);
    const difficulty = Math.max(0, 4 - number);
    const patrolSpeed = PATROL_SPEED + 0.1 * difficulty;
    const chaseSpeed = CHASE_SPEED + 0.15 * difficulty;
    const floor = {
      ...layout, number, spawnTile, homeRoomId, goalTile, goalTiles, upTile,
      patrolLinks, lookouts, random, guards: [], patrolSpeed, chaseSpeed,
      pickups: placeRoomItems(layout, homeRoomId, ITEM_IDS, randomSource(seed ^ 0xd174dc39)),
      crumbs: new Map(),
      empUntil: 0,
    };
    floor.cameras = placeCameras(floor, randomSource(seed ^ 0x62a3fb71));

    const distance = walkableTiles(tiles, spawnTile, -1, width).distance;
    const exit = tileCenter(goalTile, width);
    let candidates = [...patrolLinks.keys()].filter(tile => {
      const point = tileCenter(tile, width);
      return distance[tile] >= MIN_GUARD_DISTANCE && Math.hypot(point.x - exit.x, point.y - exit.y) >= 4;
    });
    for (let index = 0; index < GUARD_COUNTS[number]; index += 1) {
      const separation = tile => {
        const point = tileCenter(tile, width);
        return Math.min(...floor.guards.map(guard => Math.hypot(guard.x - point.x, guard.y - point.y)));
      };
      const spaced = candidates.filter(tile => separation(tile) >= GUARD_SPAWN_SPACING);
      const tile = spaced.length ? choose(spaced, random) :
        candidates.reduce((farthest, tile) => separation(tile) > separation(farthest) ? tile : farthest);
      candidates = candidates.filter(candidate => candidate !== tile);
      const guard = {
        ...tileCenter(tile, width),
        angle: 0,
        targetAngle: 0,
        mode: 'patrol',
        patrolTile: tile,
        previousPatrolTile: -1,
        lookTime: 0,
        lookCooldown: 1 + 2 * random(),
        path: [],
        pathIndex: 0,
        pathTarget: -1,
        lastSeen: null,
        unseenTime: 0,
        noticeTime: 0,
        stunnedUntil: 0,
      };
      choosePatrolPath(floor, guard);
      const next = guard.path[guard.pathIndex];
      guard.angle = guard.targetAngle = Math.atan2(next.y - guard.y, next.x - guard.x);
      floor.guards.push(guard);
    }
    return floor;
  }

  function openLanding(floor, stair) {
    const { width, routes: [main], guards } = floor;
    const landing = stairLanding(main, stair);
    const farther = 2 * landing - stair;
    // Prefer the center in front of the stairs, with room to arrive past waiting guards.
    const candidates = [landing, landing - width, landing + width, farther, farther - width, farther + width];
    return candidates.find(tile => {
      const { x, y } = tileCenter(tile, width);
      return guards.every(guard => Math.hypot(x - guard.x, y - guard.y) > PLAYER_RADIUS + GUARD_RADIUS);
    }) ?? landing;
  }

  function enterFloor(game, number) {
    let floor = game.floors.get(number);
    if (!floor) {
      const kind = game.layoutOrder[(5 - number) % game.layoutOrder.length];
      floor = createFloor(number, Math.floor(game.random() * 4294967296), kind);
      game.floors.set(number, floor);
    }
    const { width, spawnTile, goalTile, upTile } = floor;
    let arrival = spawnTile;
    let angle;
    if (game.floor) {
      const stair = game.floor.number < number ? goalTile : upTile;
      arrival = openLanding(floor, stair);
      angle = stairLanding(floor.routes[0], stair) > stair ? 0 : Math.PI;
    } else {
      const { previous } = walkableTiles(floor.tiles, goalTile, spawnTile, width);
      const from = tileCenter(spawnTile, width);
      const next = tileCenter(previous[spawnTile], width);
      angle = Math.atan2(next.y - from.y, next.x - from.x);
    }
    Object.assign(game.player, tileCenter(arrival, width), { angle });
    game.floor = floor;
    game.crumbDistance = 0;
    game.dismissedPickup = null;
    game.shot = null;
    game.alertCamera = null;
    game.cameraAlertUntil = 0;
  }

  function createGame(seed) {
    const random = randomSource(seed);
    const game = {
      random,
      itemRandom: randomSource(seed ^ 0xe43aef29),
      layoutOrder: shuffle(LAYOUTS.slice(), random),
      floors: new Map(),
      phase: 'playing',
      time: 0,
      player: {
        x: 0, y: 0, angle: 0, stamina: MAX_STAMINA, restTime: 0,
        sprintLocked: false, exhausted: false, sprinting: false,
        recovering: false, staminaRestoredAt: null, speedBoosted: false,
        speedBoostUntil: 0, freeSprintUntil: 0,
      },
      inventory: { passive: null, active: null },
      itemEffects: new Map(),
      useHintUntil: 0,
      floor: null,
    };
    enterFloor(game, 5);
    return game;
  }

  function castRay(tiles, x, y, dx, dy, limit, blocked = isWall, width = WIDTH) {
    let tileX = Math.floor(x);
    let tileY = Math.floor(y);
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
    const deltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
    let crossX = stepX === 0 ? Infinity : (stepX > 0 ? tileX + 1 - x : x - tileX) * deltaX;
    let crossY = stepY === 0 ? Infinity : (stepY > 0 ? tileY + 1 - y : y - tileY) * deltaY;

    while (Math.min(crossX, crossY) <= limit) {
      const distance = Math.min(crossX, crossY);
      if (Math.abs(crossX - crossY) < EPSILON) {
        if (blocked(tiles, tileX + stepX, tileY, width) || blocked(tiles, tileX, tileY + stepY, width)) return distance;
        tileX += stepX;
        tileY += stepY;
        crossX += deltaX;
        crossY += deltaY;
      } else if (crossX < crossY) {
        tileX += stepX;
        crossX += deltaX;
      } else {
        tileY += stepY;
        crossY += deltaY;
      }
      if (blocked(tiles, tileX, tileY, width)) return distance;
    }
    return limit;
  }

  function effectActive(until, time) {
    return until > time + EPSILON;
  }

  function guardLight(guard, floor, time) {
    if (floor && effectActive(floor.empUntil, time)) return null;
    return guard.mode === 'patrol' ? PATROL_LIGHT : CHASE_LIGHT;
  }

  function playerLight(game) {
    return game.inventory.passive?.id === 'nightVision' ? NIGHT_VISION_LIGHT : PLAYER_LIGHT;
  }

  function maxStamina(game) {
    return MAX_STAMINA + (game.inventory.passive?.id === 'sneakers' ? SNEAKER_STAMINA : 0);
  }

  function seesTarget(tiles, actor, target, light, width = WIDTH) {
    const x = target.x - actor.x;
    const y = target.y - actor.y;
    const distance = Math.hypot(x, y);
    if (distance > light.range) return false;
    if (distance < EPSILON) return true;
    const dx = x / distance;
    const dy = y / distance;
    const facing = dx * Math.cos(actor.angle) + dy * Math.sin(actor.angle);
    return facing >= Math.cos(light.halfAngle) - EPSILON &&
      castRay(tiles, actor.x, actor.y, dx, dy, distance, light.blocked, width) >= distance - EPSILON;
  }

  function cameraSeesPlayer(floor, camera, player, time) {
    const x = player.x - camera.x;
    const y = player.y - camera.y;
    const reach = CAMERA_SCAN.range + PLAYER_RADIUS;
    if (x * x + y * y > reach * reach) return false;

    const heading = cameraAngle(camera, time);
    const difference = Math.atan2(y, x) - heading;
    const relative = Math.atan2(Math.sin(difference), Math.cos(difference));
    const angle = heading + Math.max(-CAMERA_SCAN.halfAngle, Math.min(CAMERA_SCAN.halfAngle, relative));
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const distance = Math.max(0, Math.min(CAMERA_SCAN.range, x * dx + y * dy));
    if ((x - dx * distance) ** 2 + (y - dy * distance) ** 2 > PLAYER_RADIUS ** 2 + EPSILON) return false;
    return castRay(floor.tiles, camera.x, camera.y, dx, dy, distance, isSolid, floor.width) >= distance - EPSILON;
  }

  function cameraGuard(game) {
    const { floor, player, time } = game;
    const camera = floor.cameras.find(camera => cameraSeesPlayer(floor, camera, player, time));
    if (!camera) return null;
    let nearest = null;
    let bestDistance = Infinity;
    for (const guard of floor.guards) {
      if (effectActive(guard.stunnedUntil, time)) continue;
      const distance = Math.hypot(guard.x - player.x, guard.y - player.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      nearest = guard;
    }
    if (nearest) {
      game.alertCamera = camera;
      game.cameraAlertUntil = time + 1.1;
    }
    return nearest;
  }

  function canStand({tiles, width}, x, y, radius) {
    for (let row = Math.floor(y - radius); row <= Math.floor(y + radius); row += 1) {
      for (let column = Math.floor(x - radius); column <= Math.floor(x + radius); column += 1) {
        if (!isSolid(tiles, column, row, width)) continue;
        const dx = x - Math.max(column, Math.min(column + 1, x));
        const dy = y - Math.max(row, Math.min(row + 1, y));
        if (dx * dx + dy * dy < radius * radius) return false;
      }
    }
    return true;
  }

  function itemInReach({ floor, player }, item) {
    return seesTarget(floor.tiles, player, item, ITEM_REACH, floor.width);
  }

  function nearbyItem(game) {
    const { floor, player } = game;
    let nearest = null;
    let bestDistance = Infinity;
    for (const item of floor.pickups) {
      const distance = Math.hypot(item.x - player.x, item.y - player.y);
      if (distance >= bestDistance || !itemInReach(game, item)) continue;
      bestDistance = distance;
      nearest = item;
    }
    return nearest;
  }

  function pickupItem(game, item) {
    const { player, floor, inventory } = game;
    const { id, x, y } = item;
    const { type } = items[id];
    const before = maxStamina(game);
    const previous = inventory[type];
    inventory[type] = { id, floorNumber: floor.number, pickedUpAt: game.time };
    player.stamina *= maxStamina(game) / before;
    const index = floor.pickups.indexOf(item);
    if (previous) floor.pickups[index] = { id: previous.id, x, y };
    else floor.pickups.splice(index, 1);
    if (type === 'passive') game.crumbDistance = 0;
    else game.useHintUntil = 0;
    game.dismissedPickup = item;
  }

  function hasItemRoute(game) {
    const { passive } = game.inventory;
    return passive?.id === 'aiGlasses' && passive.floorNumber === game.floor.number;
  }

  function heldItem(game) {
    const { passive } = game.inventory;
    return passive?.id === 'aiGlasses' && !hasItemRoute(game) ? null : passive;
  }

  function itemRoute(game) {
    if (!hasItemRoute(game)) return [];
    const { floor, player } = game;
    const start = tileAt(player.x, player.y, floor.width);
    const tiles = floor.upTile === null ? floor.tiles : floor.tiles.slice();
    if (floor.upTile !== null) tiles[floor.upTile] = WALL;
    const { distance, previous } = walkableTiles(tiles, start, -1, floor.width);
    let nearest = -1;
    for (const tile of floor.goalTiles) {
      if (distance[tile] >= 0 && (nearest === -1 || distance[tile] < distance[nearest])) nearest = tile;
    }
    const path = [];
    for (let tile = nearest; tile !== -1; tile = previous[tile]) path.push(tileCenter(tile, floor.width));
    return path.reverse();
  }

  function leaveCrumbs(game, startX, startY, distance) {
    const { floor, player } = game;
    for (let travel = CRUMB_SPACING - game.crumbDistance; travel <= distance; travel += CRUMB_SPACING) {
      const x = startX + (player.x - startX) * travel / distance;
      const y = startY + (player.y - startY) * travel / distance;
      floor.crumbs.set(tileAt(x * 2, y * 2, floor.width * 2), { x, y });
    }
    game.crumbDistance = (game.crumbDistance + distance) % CRUMB_SPACING;
  }

  function exhaust(player) {
    player.stamina = 0;
    player.restTime = 0;
    player.sprintLocked = true;
    player.exhausted = true;
  }

  function updatePlayer(game, input, dt) {
    const { player, floor } = game;
    if (!input.sprint || input.sprintReleased) player.sprintLocked = false;

    const magnitude = Math.hypot(input.x, input.y);
    const freeSprint = effectActive(player.freeSprintUntil, game.time);
    const canSprint = magnitude > 0 && input.sprint && !player.sprintLocked && !player.exhausted && player.stamina > EPSILON;
    const sprintTime = canSprint ? (freeSprint ? dt : Math.min(dt, player.stamina)) : 0;
    const speed = player.exhausted ? EXHAUSTED_SPEED : WALK_SPEED;
    const sneakers = game.inventory.passive?.id === 'sneakers';
    const runningSpeed = sneakers ? RUN_SPEED * 1.1 : RUN_SPEED;
    const boost = effectActive(player.speedBoostUntil, game.time) ? 1.5 : 1;
    const travel = (speed * dt + (runningSpeed - speed) * sprintTime) * boost;
    const startX = player.x;
    const startY = player.y;

    if (magnitude > 0) {
      const x = startX + travel * input.x / magnitude;
      const y = startY + travel * input.y / magnitude;
      if (canStand(floor, x, startY, PLAYER_RADIUS)) player.x = x;
      if (canStand(floor, player.x, y, PLAYER_RADIUS)) player.y = y;
    }

    const distance = Math.hypot(player.x - startX, player.y - startY);
    if (distance > EPSILON) {
      player.angle = Math.atan2(player.y - startY, player.x - startX);
      if (game.inventory.passive?.id === 'bread') leaveCrumbs(game, startX, startY, distance);
    }

    player.sprinting = distance > EPSILON && sprintTime > 0;
    player.speedBoosted = boost > 1 || (player.sprinting && sneakers);
    player.recovering = false;
    if (player.sprinting) {
      player.restTime = 0;
      if (!freeSprint) {
        player.stamina -= sprintTime;
        if (player.stamina <= EPSILON) exhaust(player);
      }
    } else {
      player.restTime += dt;
      const recoveryTime = Math.max(0, Math.min(dt, player.restTime - RECOVERY_DELAY));
      const maximum = maxStamina(game);
      const rate = maximum / (player.exhausted ? 7 : 4);
      const previous = player.stamina;
      player.stamina += recoveryTime * rate;
      if (player.stamina >= maximum - EPSILON) {
        player.stamina = maximum;
        player.exhausted = false;
      }
      player.recovering = player.stamina > previous + EPSILON;
      if (player.recovering && player.stamina === maximum) player.staminaRestoredAt = game.time;
    }
  }

  function canApproach(floor, guard, x, y) {
    const regularPatrol = guard.mode === 'patrol' && guard.pathTarget === -1;
    const spacing = regularPatrol ? PATROL_SPACING : PURSUIT_SPACING;
    for (const other of floor.guards) {
      if (other === guard) continue;
      const after = (other.x - x) ** 2 + (other.y - y) ** 2;
      if (after >= spacing * spacing) continue;
      const before = (other.x - guard.x) ** 2 + (other.y - guard.y) ** 2;
      if (after < before - EPSILON) return false;
    }
    return true;
  }

  function moveToward(floor, guard, target, travel) {
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const distance = Math.hypot(dx, dy);
    if (distance < EPSILON) return travel;

    guard.targetAngle = Math.atan2(dy, dx);
    const fraction = Math.min(1, travel / distance);
    const x = distance <= travel ? target.x : guard.x + dx * fraction;
    const y = distance <= travel ? target.y : guard.y + dy * fraction;
    if (!canApproach(floor, guard, x, y)) return -1;
    guard.x = x;
    guard.y = y;
    return Math.max(0, travel - distance);
  }

  function setPath(guard, {tiles, width}, target) {
    const start = tileAt(guard.x, guard.y, width);
    const { previous } = walkableTiles(tiles, start, target, width);
    setPathFromSearch(guard, target, previous, width);
  }

  function setPathFromSearch(guard, target, previous, width) {
    const path = [];
    for (let tile = target; tile !== -1; tile = previous[tile]) path.push(tileCenter(tile, width));
    guard.path = path.reverse();
    guard.pathIndex = 0;
    guard.pathTarget = target;
  }

  function followPath(floor, guard, travel) {
    while (travel > EPSILON && guard.pathIndex < guard.path.length) {
      travel = moveToward(floor, guard, guard.path[guard.pathIndex], travel);
      if (travel > EPSILON) guard.pathIndex += 1;
    }
    return travel;
  }

  function returnToPatrol(floor, guard) {
    guard.mode = 'patrol';
    guard.unseenTime = 0;
    guard.lastSeen = null;
    guard.lookTime = 0;
    guard.lookCooldown = 1;
    rejoinPatrol(floor, guard);
  }

  function clearAlert(floor) {
    for (const guard of floor.guards) {
      guard.noticeTime = 0;
      if (guard.mode !== 'patrol') returnToPatrol(floor, guard);
    }
  }

  function showItemEffect(game, id, { key = 'used', until, floorNumber = null } = {}) {
    game.itemEffects.set(`${id}:${key}`, {
      id, key, startedAt: game.time, until: until ?? game.time + 1.5,
      timed: until !== undefined, floorNumber,
    });
  }

  function useItem(game) {
    const { inventory, floor, player, time } = game;
    if (!inventory.active) return;
    const { id } = inventory.active;
    let feedback;
    switch (id) {
      case 'monster':
        if (player.stamina < maxStamina(game)) player.staminaRestoredAt = time;
        player.stamina = maxStamina(game);
        player.exhausted = false;
        player.sprintLocked = false;
        player.speedBoostUntil = time + 7;
        feedback = { key: 'speed', until: player.speedBoostUntil };
        break;
      case 'bbGun': {
        let target = null;
        let nearest = Infinity;
        for (const guard of floor.guards) {
          if (guard.mode === 'patrol') continue;
          const distance = Math.hypot(guard.x - player.x, guard.y - player.y);
          if (distance >= nearest) continue;
          target = guard;
          nearest = distance;
        }
        if (!target) {
          game.useHintUntil = time + 2;
          return;
        }
        game.shot = { from: { x: player.x, y: player.y }, to: { x: target.x, y: target.y }, startedAt: time };
        clearAlert(floor);
        target.stunnedUntil = time + 3;
        feedback = { key: 'stun', until: target.stunnedUntil, floorNumber: floor.number };
        break;
      }
      case 'reagent':
        if (game.itemRandom() < 0.5) {
          exhaust(player);
          feedback = { key: 'exhausted' };
        } else {
          player.freeSprintUntil = time + 5;
          feedback = { key: 'freeSprint', until: player.freeSprintUntil };
        }
        break;
      case 'emp':
        floor.empUntil = time + 4;
        clearAlert(floor);
        game.cameraAlertUntil = 0;
        feedback = { key: 'blackout', until: floor.empUntil, floorNumber: floor.number };
        break;
      default:
        return;
    }
    showItemEffect(game, id, feedback);
    game.useHintUntil = 0;
    if (items[id].consumable) inventory.active = null;
  }

  function rejoinPatrol({tiles, width, guards, patrolLinks}, guard, avoidGuards = false) {
    const start = tileAt(guard.x, guard.y, width);
    const open = avoidGuards ? tiles.slice() : tiles;
    let stepsByDirection;
    if (avoidGuards) {
      for (const other of guards) {
        if (other === guard) continue;
        const occupied = tileAt(other.x, other.y, width);
        if (occupied !== start) open[occupied] = WALL;
      }
      // Prefer a right-hand detour so guards approaching head-on take different sides.
      const target = tileCenter(guard.pathTarget, width);
      const dx = target.x - guard.x;
      const dy = target.y - guard.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const forward = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) * width;
      const right = horizontal ? forward * width : -Math.sign(dy);
      stepsByDirection = [right, forward, -right, -forward];
    }

    const { distance, previous } = walkableTiles(open, start, -1, width, stepsByDirection);
    let closest = Infinity;
    for (const tile of patrolLinks.keys()) {
      const steps = distance[tile];
      if (steps < 0 || steps >= closest) continue;
      closest = steps;
      guard.patrolTile = tile;
    }
    if (closest < Infinity) {
      guard.previousPatrolTile = -1;
      setPathFromSearch(guard, guard.patrolTile, previous, width);
    }
  }

  function setPatrolStep(guard, tile, width) {
    guard.previousPatrolTile = guard.patrolTile;
    guard.patrolTile = tile;
    guard.path = [tileCenter(tile, width)];
    guard.pathIndex = 0;
    guard.pathTarget = -1;
  }

  function choosePatrolPath(floor, guard) {
    const next = [...floor.patrolLinks.get(guard.patrolTile)].filter(tile => tile !== guard.previousPatrolTile);
    const tile = next.length > 1 ? choose(next, floor.random) : next[0] ?? guard.previousPatrolTile;
    setPatrolStep(guard, tile, floor.width);
  }

  function patrol(floor, guard, dt) {
    guard.lookCooldown = Math.max(0, guard.lookCooldown - dt);
    if (guard.lookTime > 0) {
      guard.lookTime -= dt;
      return;
    }

    let travel = followPath(floor, guard, floor.patrolSpeed * dt);
    while (travel > EPSILON) {
      const places = floor.lookouts.get(guard.patrolTile);
      if (places && guard.lookCooldown === 0 && floor.random() < 0.58) {
        const point = tileCenter(choose(places, floor.random), floor.width);
        guard.targetAngle = Math.atan2(point.y - guard.y, point.x - guard.x);
        guard.lookTime = 0.65;
        guard.lookCooldown = 3 + floor.random() * 2;
        return;
      }
      choosePatrolPath(floor, guard);
      travel = followPath(floor, guard, travel);
    }
    if (travel < 0) {
      if (guard.pathTarget === -1) {
        setPatrolStep(guard, guard.previousPatrolTile, floor.width);
      } else {
        rejoinPatrol(floor, guard, true);
        guard.lookTime = 0.2;
      }
    }
  }

  function clearPath({tiles, width}, guard, target, distance) {
    const dx = (target.x - guard.x) / distance;
    const dy = (target.y - guard.y) / distance;
    const limit = distance - EPSILON;
    return [0, -GUARD_RADIUS, GUARD_RADIUS].every(offset => (
      castRay(tiles, guard.x - dy * offset, guard.y + dx * offset, dx, dy, limit, isSolid, width) >= limit
    ));
  }

  function pursue(floor, guard, dt) {
    const target = guard.lastSeen;
    const distance = Math.hypot(target.x - guard.x, target.y - guard.y);
    if (distance < EPSILON) return;

    const travel = floor.chaseSpeed * dt;
    if (clearPath(floor, guard, target, distance)) {
      guard.pathTarget = -1;
      moveToward(floor, guard, target, travel);
      return;
    }

    const targetTile = tileAt(target.x, target.y, floor.width);
    if (targetTile !== guard.pathTarget) setPath(guard, floor, targetTile);
    const remaining = followPath(floor, guard, travel);
    if (remaining > EPSILON) moveToward(floor, guard, target, remaining);
  }

  function turnGuard(guard, dt) {
    const speed = guard.mode === 'patrol' ? PATROL_TURN_SPEED : CHASE_TURN_SPEED;
    const difference = guard.targetAngle - guard.angle;
    const shortest = Math.atan2(Math.sin(difference), Math.cos(difference));
    guard.angle += Math.sign(shortest) * Math.min(Math.abs(shortest), speed * dt);
  }

  function updateGuard(floor, guard, player, light, dt, tracked) {
    const visible = tracked || (light && seesTarget(floor.tiles, guard, player, light, floor.width));
    if (guard.mode === 'patrol') {
      guard.noticeTime = visible ? guard.noticeTime + dt : 0;
      if (visible && !tracked && guard.noticeTime < NOTICE_TIME - EPSILON) {
        guard.targetAngle = Math.atan2(player.y - guard.y, player.x - guard.x);
        turnGuard(guard, dt);
        return;
      }
    }

    if (visible) {
      if (guard.mode === 'patrol') guard.pathTarget = -1;
      guard.mode = 'chase';
      guard.noticeTime = 0;
      guard.lastSeen = { x: player.x, y: player.y };
      guard.unseenTime = 0;
    } else if (guard.mode !== 'patrol') {
      guard.mode = 'search';
      guard.unseenTime += dt;
      if (guard.unseenTime >= SEARCH_TIME - EPSILON) returnToPatrol(floor, guard);
    }

    if (guard.mode === 'patrol') patrol(floor, guard, dt);
    else pursue(floor, guard, dt);
    turnGuard(guard, dt);
  }

  function step(game, input, dt) {
    if (game.phase !== 'playing') return;
    game.time += dt;
    for (const [key, effect] of game.itemEffects) {
      if (!effectActive(effect.until, game.time)) game.itemEffects.delete(key);
    }
    if (game.dismissedPickup && !itemInReach(game, game.dismissedPickup)) game.dismissedPickup = null;
    if (input.interact) {
      const item = nearbyItem(game);
      if (item) pickupItem(game, item);
      else useItem(game);
    }
    updatePlayer(game, input, dt);
    const { player, floor, time } = game;

    const tile = tileAt(player.x, player.y, floor.width);
    const goingUp = tile === floor.upTile;
    if (goingUp || floor.goalTiles.includes(tile)) {
      if (!goingUp && game.inventory.passive?.id === 'aiGlasses') {
        game.inventory.passive = null;
        showItemEffect(game, 'aiGlasses', { key: 'spent' });
      }
      if (floor.number === 1 && !goingUp) game.phase = 'escaped';
      else {
        clearAlert(floor);
        enterFloor(game, floor.number + (goingUp ? 1 : -1));
      }
      return;
    }

    const inHome = floor.homeRoomId !== null && floor.roomsByTile[tile] === floor.homeRoomId;
    if (inHome) clearAlert(floor);
    const tracked = !inHome && !effectActive(floor.empUntil, time) ? cameraGuard(game) : null;
    for (const guard of floor.guards) {
      if (effectActive(guard.stunnedUntil, time)) continue;
      const light = inHome ? null : guardLight(guard, floor, time);
      updateGuard(floor, guard, player, light, dt, tracked === guard);
      if (light && Math.hypot(player.x - guard.x, player.y - guard.y) <= PLAYER_RADIUS + GUARD_RADIUS) {
        game.phase = 'caught';
        return;
      }
    }
  }

  const core = {
    WIDTH, HEIGHT, PLAYER_RADIUS, GUARD_RADIUS, MAX_STAMINA, PLAYER_LIGHT, SHOT_DURATION, CAMERA_SCAN,
    createFloor, createGame, step, guardLight, playerLight, maxStamina, nearbyItem, hasItemRoute, itemRoute, heldItem,
    cameraAngle, cameraSeesPlayer, cameraSweepTiles,
    isWall, isSolid, tileAt, tileCenter, walkableTiles, castRay, seesTarget,
  };

  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.DormEscape = core;
})(globalThis);
