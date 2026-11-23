(function (root) {
  'use strict';

  const map = typeof module === 'object' && module.exports ? require('./game-map.js') : root.DormMap;
  const {
    WIDTH, HEIGHT, WALL, LAYOUTS, randomSource, choose, shuffle, tileAt, tileCenter,
    isWall, isSolid, walkableTiles, createLayout,
  } = map;
  const MIN_ROUTE = 26;
  const MIN_GUARD_DISTANCE = 12;
  const GUARD_COUNTS = [0, 4, 3, 3, 2, 1];
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
    const layout = createLayout(random, kind, 5 - number);
    const { tiles, rooms, routes, width } = layout;
    const [main, bypass] = routes;
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
    const spawnTile = choose(starts.slice(0, 2), random).tile;
    const goalTile = goal.tile;
    const goalTiles = [goalTile - width, goalTile, goalTile + width];
    const lookouts = doorwayLookouts(rooms, routes);
    const floor = { ...layout, number, spawnTile, goalTile, goalTiles, lookouts, random, guards: [] };

    const distance = walkableTiles(tiles, spawnTile, -1, width).distance;
    const count = GUARD_COUNTS[number];
    // Floor 5 leaves the entry half of the main corridor open for learning the controls.
    const middle = Math.floor(main.length / 2);
    const entranceAtStart = goalTile === main.at(-1);
    const patrolStart = number === 5 && entranceAtStart ? middle : 3;
    const patrolEnd = number === 5 && !entranceAtStart ? middle : main.length - 3;
    const hallway = main.slice(patrolStart, patrolEnd);
    const exit = tileCenter(goalTile, width);
    const safe = tile => {
      const point = tileCenter(tile, width);
      return distance[tile] >= MIN_GUARD_DISTANCE && Math.hypot(point.x - exit.x, point.y - exit.y) >= 4;
    };
    const hallSpawns = hallway.filter(safe);
    const sideSpawns = bypass.filter(safe);
    const occupied = new Set();
    for (let index = 0; index < count; index += 1) {
      const useBypass = index > 0 && index === count - 1 && sideSpawns.some(tile => !occupied.has(tile));
      const route = useBypass ? bypass : hallway;
      const candidates = shuffle((useBypass ? sideSpawns : hallSpawns).filter(tile => !occupied.has(tile)), random);
      if (index === 0) candidates.sort((a, b) => distance[a] - distance[b]);
      else {
        const separation = tile => {
          const point = tileCenter(tile, width);
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
        ...tileCenter(tile, width),
        angle: 0,
        targetAngle: 0,
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
        noticeTime: 0,
      };
      choosePatrolPath(guard, width);
      const next = guard.path[guard.pathIndex];
      guard.angle = guard.targetAngle = Math.atan2(next.y - guard.y, next.x - guard.x);
      floor.guards.push(guard);
    }
    return floor;
  }

  function enterFloor(game, number) {
    const kind = game.layoutOrder[(5 - number) % game.layoutOrder.length];
    const floor = createFloor(number, Math.floor(game.random() * 4294967296), kind);
    const spawn = tileCenter(floor.spawnTile, floor.width);
    const routeFromGoal = walkableTiles(floor.tiles, floor.goalTile, floor.spawnTile, floor.width);
    const firstStep = tileCenter(routeFromGoal.previous[floor.spawnTile], floor.width);
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

  function guardLight(guard) {
    return guard.mode === 'patrol' ? PATROL_LIGHT : CHASE_LIGHT;
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
      castRay(tiles, actor.x, actor.y, dx, dy, distance, isWall, width) >= distance - EPSILON;
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
      if (canStand(floor, x, startY, PLAYER_RADIUS)) player.x = x;
      if (canStand(floor, player.x, y, PLAYER_RADIUS)) player.y = y;
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

  function rejoinPatrol({tiles, width, guards}, guard, avoidGuards = false) {
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
    const route = guard.patrolRoute;
    let closest = Infinity;
    for (let index = 0; index < route.length; index += 1) {
      const steps = distance[route[index]];
      if (steps < 0 || steps >= closest) continue;
      closest = steps;
      guard.routeIndex = index;
    }
    if (closest < Infinity) setPathFromSearch(guard, route[guard.routeIndex], previous, width);
  }

  function choosePatrolPath(guard, width) {
    const route = guard.patrolRoute;
    const next = guard.routeIndex + guard.direction;
    if (next < 0 || next >= route.length) guard.direction *= -1;
    guard.routeIndex += guard.direction;
    guard.path = [tileCenter(route[guard.routeIndex], width)];
    guard.pathIndex = 0;
    guard.pathTarget = -1;
  }

  function patrol(floor, guard, dt) {
    guard.lookCooldown = Math.max(0, guard.lookCooldown - dt);
    if (guard.lookTime > 0) {
      guard.lookTime -= dt;
      return;
    }

    let travel = followPath(floor, guard, PATROL_SPEED * dt);
    while (travel > EPSILON) {
      const places = floor.lookouts.get(guard.patrolRoute[guard.routeIndex]);
      if (places && guard.lookCooldown === 0 && floor.random() < 0.58) {
        const point = tileCenter(choose(places, floor.random), floor.width);
        guard.targetAngle = Math.atan2(point.y - guard.y, point.x - guard.x);
        guard.lookTime = 0.65;
        guard.lookCooldown = 3 + floor.random() * 2;
        return;
      }
      choosePatrolPath(guard, floor.width);
      travel = followPath(floor, guard, travel);
    }
    if (travel < 0) {
      if (guard.pathTarget === -1) {
        guard.direction *= -1;
        choosePatrolPath(guard, floor.width);
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

    const travel = CHASE_SPEED * dt;
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

  function updateGuard(floor, guard, player, dt) {
    const visible = seesTarget(floor.tiles, guard, player, guardLight(guard), floor.width);
    if (guard.mode === 'patrol') {
      guard.noticeTime = visible ? guard.noticeTime + dt : 0;
      if (visible && guard.noticeTime < NOTICE_TIME - EPSILON) {
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
    updatePlayer(game, input, dt);
    const { player, floor } = game;

    if (floor.goalTiles.includes(tileAt(player.x, player.y, floor.width))) {
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
