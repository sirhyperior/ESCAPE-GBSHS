(function (root) {
  'use strict';

  const map = typeof module === 'object' && module.exports ? require('./game-map.js') : root.DormMap;
  const {
    WIDTH, HEIGHT, LAYOUTS, randomSource, choose, shuffle, tileAt, tileCenter,
    isWall, isSolid, walkableTiles, createLayout,
  } = map;
  const MIN_ROUTE = 26;
  const MIN_GUARD_DISTANCE = 12;
  const GUARD_COUNTS = [0, 5, 4, 3, 2, 2];
  const PLAYER_RADIUS = 0.25;
  const GUARD_RADIUS = 0.24;
  const WALK_SPEED = 3;
  const EXHAUSTED_SPEED = 1.8;
  const RUN_SPEED = 5;
  const PATROL_SPEED = 2.35;
  const CHASE_SPEED = 4.1;
  const MAX_STAMINA = 3;
  const RECOVERY_DELAY = 0.75;
  const RECOVERY_RATE = MAX_STAMINA / 4;
  const EXHAUSTED_RECOVERY_RATE = MAX_STAMINA / 7;
  const SEARCH_TIME = 2.5;
  const EPSILON = 1e-9;
  const PLAYER_LIGHT = Object.freeze({ range: 5, halfAngle: 55 * Math.PI / 180 });
  const PATROL_LIGHT = Object.freeze({ range: 6.5, halfAngle: 55 * Math.PI / 180 });
  const CHASE_LIGHT = Object.freeze({ range: 8.25, halfAngle: 70 * Math.PI / 180 });

  function doorwayLookouts(rooms, routes) {
    const routeTiles = new Set(routes.flat());
    const lookouts = new Map();
    for (const { entrance } of rooms) {
      for (let index = 0; index < entrance.hall.length; index += 1) {
        const hall = entrance.hall[index];
        const inward = entrance.wall[index] - hall;
        const tile = routeTiles.has(hall) ? hall : hall - inward;
        if (!routeTiles.has(tile)) continue;
        if (!lookouts.has(tile)) lookouts.set(tile, []);
        lookouts.get(tile).push(entrance.inside[index]);
      }
    }
    return lookouts;
  }

  function createFloor(number, seed, kind) {
    const random = randomSource(seed);
    const layout = createLayout(random, kind);
    const { tiles, rooms, routes } = layout;
    const [main, bypass] = routes;
    const ends = [main[0], main.at(-1)];
    const goalTile = choose(ends, random);
    const otherEnd = ends.find(tile => tile !== goalTile);
    const fromEnd = walkableTiles(tiles, otherEnd).distance;
    const fromGoal = walkableTiles(tiles, goalTile).distance;
    const bedrooms = rooms.filter(room => !room.lounge && fromGoal[room.tile] >= MIN_ROUTE);
    bedrooms.sort((a, b) => fromEnd[a.tile] - fromEnd[b.tile]);
    const spawnTile = choose(bedrooms.slice(0, 2), random).tile;
    const goalTiles = [goalTile - WIDTH, goalTile, goalTile + WIDTH];
    const lookouts = doorwayLookouts(rooms, routes);
    const floor = { ...layout, number, spawnTile, goalTile, goalTiles, lookouts, random, guards: [] };

    const distance = walkableTiles(tiles, spawnTile).distance;
    const count = GUARD_COUNTS[number];
    const hallway = main.slice(3, -3);
    const exit = tileCenter(goalTile);
    const safe = tile => {
      const point = tileCenter(tile);
      return distance[tile] >= MIN_GUARD_DISTANCE && Math.hypot(point.x - exit.x, point.y - exit.y) >= 4;
    };
    const hallSpawns = hallway.filter(safe);
    const sideSpawns = bypass.filter(safe);
    const occupied = new Set();
    for (let index = 0; index < count; index += 1) {
      const useBypass = index === count - 1 && sideSpawns.some(tile => !occupied.has(tile));
      const route = useBypass ? bypass : hallway;
      const candidates = shuffle((useBypass ? sideSpawns : hallSpawns).filter(tile => !occupied.has(tile)), random);
      if (index === 0) candidates.sort((a, b) => distance[a] - distance[b]);
      else {
        const separation = tile => {
          const point = tileCenter(tile);
          return Math.min(...floor.guards.map(guard => Math.hypot(guard.x - point.x, guard.y - point.y)));
        };
        candidates.sort((a, b) => separation(b) - separation(a));
      }
      const tile = index === 0 ? choose(candidates.slice(0, 3), random) : candidates[0];
      occupied.add(tile);

      const startIndex = route.indexOf(tile);
      const reach = choose([8, 10, 12], random);
      const first = Math.max(0, startIndex - reach);
      const patrolRoute = route.slice(first, startIndex + reach + 1);
      const guard = {
        ...tileCenter(tile),
        angle: 0,
        mode: 'patrol',
        patrolRoute,
        routeIndex: startIndex - first,
        direction: choose([-1, 1], random),
        lookTime: 0,
        lookCooldown: 1 + 2 * random(),
        path: [],
        pathIndex: 0,
        pathTarget: -1,
        lastSeen: null,
        unseenTime: 0,
      };
      choosePatrolPath(guard);
      const next = guard.path[guard.pathIndex];
      guard.angle = Math.atan2(next.y - guard.y, next.x - guard.x);
      floor.guards.push(guard);
    }
    return floor;
  }

  function enterFloor(game, number) {
    const kind = game.layoutOrder[(5 - number) % game.layoutOrder.length];
    const floor = createFloor(number, Math.floor(game.random() * 4294967296), kind);
    const spawn = tileCenter(floor.spawnTile);
    const routeFromGoal = walkableTiles(floor.tiles, floor.goalTile, floor.spawnTile);
    const firstStep = tileCenter(routeFromGoal.previous[floor.spawnTile]);
    Object.assign(game.player, spawn, { angle: Math.atan2(firstStep.y - spawn.y, firstStep.x - spawn.x) });
    game.floor = floor;
  }

  function createGame(seed) {
    const random = randomSource(seed);
    const game = {
      random,
      layoutOrder: shuffle(LAYOUTS.slice(), random),
      phase: 'playing',
      player: { x: 0, y: 0, angle: 0, stamina: MAX_STAMINA, restTime: 0, sprintLocked: false, exhausted: false },
      floor: null,
    };
    enterFloor(game, 5);
    return game;
  }

  function castRay(tiles, x, y, dx, dy, limit, blocked = isWall) {
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
        if (blocked(tiles, tileX + stepX, tileY) || blocked(tiles, tileX, tileY + stepY)) return distance;
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
      if (blocked(tiles, tileX, tileY)) return distance;
    }
    return limit;
  }

  function guardLight(guard) {
    return guard.mode === 'patrol' ? PATROL_LIGHT : CHASE_LIGHT;
  }

  function seesTarget(tiles, actor, target, light) {
    const x = target.x - actor.x;
    const y = target.y - actor.y;
    const distance = Math.hypot(x, y);
    if (distance > light.range) return false;
    if (distance < EPSILON) return true;
    const dx = x / distance;
    const dy = y / distance;
    const facing = dx * Math.cos(actor.angle) + dy * Math.sin(actor.angle);
    return facing >= Math.cos(light.halfAngle) - EPSILON &&
      castRay(tiles, actor.x, actor.y, dx, dy, distance) >= distance - EPSILON;
  }

  function canStand(tiles, x, y, radius) {
    for (let row = Math.floor(y - radius); row <= Math.floor(y + radius); row += 1) {
      for (let column = Math.floor(x - radius); column <= Math.floor(x + radius); column += 1) {
        if (!isSolid(tiles, column, row)) continue;
        const dx = x - Math.max(column, Math.min(column + 1, x));
        const dy = y - Math.max(row, Math.min(row + 1, y));
        if (dx * dx + dy * dy < radius * radius) return false;
      }
    }
    return true;
  }

  function updatePlayer(game, input, dt) {
    const { player, floor } = game;
    if (!input.sprint || input.sprintReleased) player.sprintLocked = false;

    const magnitude = Math.hypot(input.x, input.y);
    const canSprint = magnitude > 0 && input.sprint && !player.sprintLocked && !player.exhausted && player.stamina > EPSILON;
    const sprintTime = canSprint ? Math.min(dt, player.stamina) : 0;
    const speed = player.exhausted ? EXHAUSTED_SPEED : WALK_SPEED;
    const travel = speed * dt + (RUN_SPEED - speed) * sprintTime;
    const startX = player.x;
    const startY = player.y;

    if (magnitude > 0) {
      const x = startX + travel * input.x / magnitude;
      const y = startY + travel * input.y / magnitude;
      if (canStand(floor.tiles, x, startY, PLAYER_RADIUS)) player.x = x;
      if (canStand(floor.tiles, player.x, y, PLAYER_RADIUS)) player.y = y;
    }

    const moved = Math.hypot(player.x - startX, player.y - startY) > EPSILON;
    if (moved) player.angle = Math.atan2(player.y - startY, player.x - startX);

    if (moved && sprintTime > 0) {
      player.stamina -= sprintTime;
      player.restTime = 0;
      if (player.stamina <= EPSILON) {
        player.stamina = 0;
        player.sprintLocked = true;
        player.exhausted = true;
      }
    } else {
      player.restTime += dt;
      const recoveryTime = Math.max(0, Math.min(dt, player.restTime - RECOVERY_DELAY));
      const rate = player.exhausted ? EXHAUSTED_RECOVERY_RATE : RECOVERY_RATE;
      player.stamina += recoveryTime * rate;
      if (player.stamina >= MAX_STAMINA - EPSILON) {
        player.stamina = MAX_STAMINA;
        player.exhausted = false;
      }
    }
  }

  function moveToward(guard, target, travel) {
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const distance = Math.hypot(dx, dy);
    if (distance < EPSILON) return travel;

    guard.angle = Math.atan2(dy, dx);
    if (distance <= travel) {
      Object.assign(guard, target);
      return travel - distance;
    }
    guard.x += dx * travel / distance;
    guard.y += dy * travel / distance;
    return 0;
  }

  function setPath(guard, tiles, target) {
    const start = tileAt(guard.x, guard.y);
    const { previous } = walkableTiles(tiles, start, target);
    const path = [];
    for (let tile = target; tile !== -1; tile = previous[tile]) path.push(tileCenter(tile));
    guard.path = path.reverse();
    guard.pathIndex = 0;
    guard.pathTarget = target;
  }

  function followPath(guard, travel) {
    while (travel > EPSILON && guard.pathIndex < guard.path.length) {
      travel = moveToward(guard, guard.path[guard.pathIndex], travel);
      if (travel > EPSILON) guard.pathIndex += 1;
    }
    return travel;
  }

  function returnToPatrol(floor, guard) {
    const start = tileAt(guard.x, guard.y);
    const { distance } = walkableTiles(floor.tiles, start);
    const route = guard.patrolRoute;
    guard.routeIndex = route.reduce((closest, tile, index) => distance[tile] < distance[route[closest]] ? index : closest, 0);
    guard.mode = 'patrol';
    guard.unseenTime = 0;
    guard.lastSeen = null;
    guard.lookTime = 0;
    guard.lookCooldown = 1;
    setPath(guard, floor.tiles, route[guard.routeIndex]);
  }

  function choosePatrolPath(guard) {
    const route = guard.patrolRoute;
    const next = guard.routeIndex + guard.direction;
    if (next < 0 || next >= route.length) guard.direction *= -1;
    guard.routeIndex += guard.direction;
    guard.path = [tileCenter(route[guard.routeIndex])];
    guard.pathIndex = 0;
  }

  function patrol(floor, guard, dt) {
    guard.lookCooldown = Math.max(0, guard.lookCooldown - dt);
    if (guard.lookTime > 0) {
      guard.lookTime -= dt;
      return;
    }

    let travel = followPath(guard, PATROL_SPEED * dt);
    while (travel > EPSILON) {
      const places = floor.lookouts.get(guard.patrolRoute[guard.routeIndex]);
      if (places && guard.lookCooldown === 0 && floor.random() < 0.58) {
        const point = tileCenter(choose(places, floor.random));
        guard.angle = Math.atan2(point.y - guard.y, point.x - guard.x);
        guard.lookTime = 0.65;
        guard.lookCooldown = 3 + floor.random() * 2;
        return;
      }
      choosePatrolPath(guard);
      travel = followPath(guard, travel);
    }
  }

  function clearPath(tiles, guard, target, distance) {
    const dx = (target.x - guard.x) / distance;
    const dy = (target.y - guard.y) / distance;
    const limit = distance - EPSILON;
    return [0, -GUARD_RADIUS, GUARD_RADIUS].every(offset => (
      castRay(tiles, guard.x - dy * offset, guard.y + dx * offset, dx, dy, limit, isSolid) >= limit
    ));
  }

  function pursue(floor, guard, dt) {
    const target = guard.lastSeen;
    const distance = Math.hypot(target.x - guard.x, target.y - guard.y);
    if (distance < EPSILON) return;

    const travel = CHASE_SPEED * dt;
    if (clearPath(floor.tiles, guard, target, distance)) {
      guard.pathTarget = -1;
      moveToward(guard, target, travel);
      return;
    }

    const targetTile = tileAt(target.x, target.y);
    if (targetTile !== guard.pathTarget) setPath(guard, floor.tiles, targetTile);
    const remaining = followPath(guard, travel);
    if (remaining > EPSILON) moveToward(guard, target, remaining);
  }

  function updateGuard(floor, guard, player, dt) {
    if (seesTarget(floor.tiles, guard, player, guardLight(guard))) {
      if (guard.mode === 'patrol') guard.pathTarget = -1;
      guard.mode = 'chase';
      guard.lastSeen = { x: player.x, y: player.y };
      guard.unseenTime = 0;
    } else if (guard.mode !== 'patrol') {
      guard.mode = 'search';
      guard.unseenTime += dt;
      if (guard.unseenTime >= SEARCH_TIME - EPSILON) returnToPatrol(floor, guard);
    }

    if (guard.mode === 'patrol') patrol(floor, guard, dt);
    else pursue(floor, guard, dt);
  }

  function step(game, input, dt) {
    if (game.phase !== 'playing') return;
    updatePlayer(game, input, dt);
    const { player, floor } = game;

    if (floor.goalTiles.includes(tileAt(player.x, player.y))) {
      if (floor.number === 1) game.phase = 'escaped';
      else enterFloor(game, floor.number - 1);
      return;
    }

    for (const guard of floor.guards) {
      updateGuard(floor, guard, player, dt);
      if (Math.hypot(player.x - guard.x, player.y - guard.y) <= PLAYER_RADIUS + GUARD_RADIUS) {
        game.phase = 'caught';
        return;
      }
    }
  }

  const core = {
    WIDTH, HEIGHT, PLAYER_RADIUS, GUARD_RADIUS, MAX_STAMINA, PLAYER_LIGHT,
    createFloor, createGame, step, guardLight, isWall, tileAt, tileCenter, walkableTiles, castRay, seesTarget,
  };

  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.DormEscape = core;
})(globalThis);
