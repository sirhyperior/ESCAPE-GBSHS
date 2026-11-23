(function (root) {
  'use strict';

  const WIDTH = 43;
  const HEIGHT = 31;
  const WALL = 1;
  const FURNITURE = 2;
  const LAYOUTS = ['straight', 'dogleg', 'loop'];
  const LOUNGE_CHANCE = 0.35;
  const BEDROOM_SIZES = [[5, 4], [4, 5], [5, 5], [6, 4], [4, 6]];
  const LOUNGE_SIZES = [[6, 5], [5, 6], [6, 6], [7, 6], [6, 7]];
  const PERSONAL_BELONGINGS = ['suitcase', 'duffel', 'plant', 'books', 'shoes', 'desk'];
  const FABRICS = ['#647d82', '#83665d', '#6a7c64', '#82765a', '#6b657f', '#8b795f'];
  const LONG_FURNITURE = new Set(['bunk', 'desk', 'sofa', 'table', 'rug']);

  function randomSource(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function choose(options, random) {
    return options[Math.floor(random() * options.length)];
  }

  function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }

  function tileAt(x, y, width = WIDTH) {
    return Math.floor(y) * width + Math.floor(x);
  }

  function tileCenter(tile, width = WIDTH) {
    return { x: tile % width + 0.5, y: Math.floor(tile / width) + 0.5 };
  }

  function isWall(tiles, x, y, width = WIDTH) {
    return x < 0 || y < 0 || x >= width || y * width >= tiles.length || tiles[tileAt(x, y, width)] === WALL;
  }

  function isSolid(tiles, x, y, width = WIDTH) {
    return isWall(tiles, x, y, width) || tiles[tileAt(x, y, width)] === FURNITURE;
  }

  function walkableTiles(tiles, start, end = -1, width = WIDTH, neighborSteps = [-width, 1, width, -1]) {
    const distance = new Int16Array(tiles.length).fill(-1);
    const previous = new Int16Array(tiles.length).fill(-1);
    const queue = new Int16Array(tiles.length);
    let head = 0;
    let tail = 1;
    queue[0] = start;
    distance[start] = 0;

    // A solid border keeps every neighbor of a walkable tile inside the map.
    while (head < tail) {
      const tile = queue[head++];
      if (tile === end) break;
      for (const step of neighborSteps) {
        const neighbor = tile + step;
        if (distance[neighbor] !== -1 || tiles[neighbor] !== 0) continue;
        distance[neighbor] = distance[tile] + 1;
        previous[neighbor] = tile;
        queue[tail++] = neighbor;
      }
    }
    return { distance, previous };
  }

  function corridorPlan(kind, random, width, height) {
    const left = 4;
    const right = width - 5;
    const extraWidth = width - WIDTH;
    const extraHeight = height - HEIGHT;
    if (kind === 'straight') {
      const y = choose([14, 15, 16], random) + extraHeight / 2;
      const bypass = y + choose([-1, 1], random) * (9 + extraHeight / 2);
      const first = choose([13, 15, 17], random) + extraWidth / 4;
      const last = choose([26, 28, 30], random) + 3 * extraWidth / 4;
      return [
        [[left, y], [right, y]],
        [[left, y], [left, bypass], [right, bypass], [right, y]],
        [[first, y], [first, bypass]],
        [[last, y], [last, bypass]],
      ];
    }
    if (kind === 'dogleg') {
      const top = choose([9, 10, 11], random);
      const bottom = choose([19, 20, 21], random) + extraHeight;
      const turn = choose([20, 22, 24], random) + extraWidth / 2;
      const bypass = Math.floor((top + bottom) / 2) + choose([-1, 0, 1], random);
      return [
        [[left, top], [turn, top], [turn, bottom], [right, bottom]],
        [[left, top], [left, bypass], [right, bypass], [right, bottom]],
      ];
    }
    const top = choose([8, 9, 10], random);
    const bottom = choose([19, 20, 21], random) + extraHeight;
    const west = choose([9, 10, 11], random) + extraWidth / 4;
    const east = choose([31, 32, 33], random) + 3 * extraWidth / 4;
    const bypass = bottom + choose([4, 5, 6], random);
    return [
      [[left, top], [east, top], [east, bottom], [right, bottom]],
      [[left, top], [left, bypass], [right, bypass], [right, bottom]],
      [[west, top], [west, bypass]],
      [[east, bottom], [east, bypass]],
    ];
  }

  function carveCorridor(tiles, points, width, mapWidth) {
    const before = Math.floor((width - 1) / 2);
    const route = [];
    for (let index = 1; index < points.length; index += 1) {
      const [startX, startY] = points[index - 1];
      const [endX, endY] = points[index];
      const stepX = Math.sign(endX - startX);
      const stepY = Math.sign(endY - startY);
      const length = Math.abs(endX - startX) + Math.abs(endY - startY);
      for (let distance = index === 1 ? 0 : 1; distance <= length; distance += 1) {
        const x = startX + stepX * distance;
        const y = startY + stepY * distance;
        route.push(tileAt(x, y, mapWidth));
        for (let row = y - before; row < y - before + width; row += 1) {
          for (let column = x - before; column < x - before + width; column += 1) {
            tiles[tileAt(column, row, mapWidth)] = 0;
          }
        }
      }
    }
    return route;
  }

  function roomEntrances({tiles, width, height}, random) {
    const entries = [];
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        if (tiles[tileAt(x, y, width)] !== 0) continue;
        for (const [outX, outY] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const spanX = Math.abs(outY);
          const spanY = Math.abs(outX);
          const hall = [tileAt(x, y, width), tileAt(x + spanX, y + spanY, width)];
          const wall = hall.map(tile => tile + outX + outY * width);
          if (tiles[hall[1]] !== 0 || wall.some(tile => tiles[tile] !== WALL)) continue;
          entries.push({ x, y, outX, outY, hall, wall });
        }
      }
    }
    return shuffle(entries, random);
  }

  function roomFits({tiles, width: mapWidth, height: mapHeight}, left, top, width, height) {
    if (left < 1 || top < 1 || left + width >= mapWidth || top + height >= mapHeight) return false;
    for (let y = top - 1; y <= top + height; y += 1) {
      for (let x = left - 1; x <= left + width; x += 1) {
        if (tiles[tileAt(x, y, mapWidth)] !== WALL) return false;
      }
    }
    return true;
  }

  function createRooms(layout, depth, random) {
    const { tiles, roomsByTile, doorways, width: mapWidth } = layout;
    const rooms = [];
    const count = choose([7, 8, 8, 9, 10], random) + depth;
    const hasLounge = random() < LOUNGE_CHANCE;
    for (const entry of roomEntrances(layout, random)) {
      const { x, y, outX, outY, hall, wall } = entry;
      const lounge = hasLounge && rooms.length === 0;
      const sizes = shuffle((lounge ? LOUNGE_SIZES : BEDROOM_SIZES).slice(), random);
      for (const [width, height] of sizes) {
        const span = outX === 0 ? width : height;
        const shifts = shuffle(span === 4 ? [0, 2] : [1, span - 3], random);
        const placement = shifts.map(shift => ({
          shift,
          left: outX === 0 ? x - shift : x + 2 * outX - (outX < 0 ? width - 1 : 0),
          top: outY === 0 ? y - shift : y + 2 * outY - (outY < 0 ? height - 1 : 0),
        })).find(({left, top}) => roomFits(layout, left, top, width, height));
        if (!placement) continue;
        const { shift, left, top } = placement;

        const id = rooms.length;
        const tile = tileAt(left + Math.floor(width / 2), top + Math.floor(height / 2), mapWidth);
        const inside = wall.map(part => part + outX + outY * mapWidth);
        // The wider wall beside the door shields this corner from the hall.
        const afterDoor = span - shift - 2;
        const step = outX === 0 ? 1 : mapWidth;
        const hidingTile = shift >= afterDoor ? inside[0] - shift * step : inside[1] + afterDoor * step;
        rooms.push({ id, tile, left, top, width, height, entrance: { hall, wall, inside }, lounge, hidingTile });
        for (let row = top; row < top + height; row += 1) {
          for (let column = left; column < left + width; column += 1) {
            const space = tileAt(column, row, mapWidth);
            tiles[space] = 0;
            roomsByTile[space] = id;
          }
        }
        for (const space of wall) {
          tiles[space] = 0;
          doorways[space] = outX ? 1 : 2;
        }
        break;
      }
      if (rooms.length === count) break;
    }
    return rooms;
  }

  function roomStaysConnected({tiles, roomsByTile, width}, room, freeTiles) {
    const reachable = new Set([room.tile]);
    const queue = [room.tile];
    const neighborSteps = [-width, 1, width, -1];
    for (let index = 0; index < queue.length; index += 1) {
      for (const step of neighborSteps) {
        const tile = queue[index] + step;
        if (roomsByTile[tile] !== room.id || tiles[tile] !== 0 || reachable.has(tile)) continue;
        reachable.add(tile);
        queue.push(tile);
      }
    }
    return reachable.size === freeTiles;
  }

  function furnishRoom(layout, room, random) {
    const { tiles, width: mapWidth } = layout;
    const objects = [];
    const reserved = new Set([room.tile, room.hidingTile, ...room.entrance.inside]);
    let freeTiles = room.width * room.height;
    const belongings = shuffle(PERSONAL_BELONGINGS.slice(), random).slice(0, 2);
    const pieces = room.lounge ? ['sofa', 'table', 'seat', 'plant', 'rug'] : ['bunk', 'wardrobe', ...belongings];
    if (!room.lounge && random() < 0.5) pieces.push('rug');
    const fabric = choose(FABRICS, random);

    for (const kind of pieces) {
      const solid = kind !== 'rug' && kind !== 'shoes';
      const candidates = [];
      const rotations = LONG_FURNITURE.has(kind) ? [[2, 1], [1, 2]] : [[1, 1]];
      for (const [width, height] of rotations) {
        for (let y = room.top; y + height <= room.top + room.height; y += 1) {
          for (let x = room.left; x + width <= room.left + room.width; x += 1) {
            const againstWall = x === room.left || y === room.top || x + width === room.left + room.width || y + height === room.top + room.height;
            if (kind !== 'rug' && !againstWall) continue;
            const footprint = [];
            for (let dy = 0; dy < height; dy += 1) {
              for (let dx = 0; dx < width; dx += 1) footprint.push(tileAt(x + dx, y + dy, mapWidth));
            }
            if (footprint.every(tile => tiles[tile] === 0 && !reserved.has(tile))) {
              candidates.push({ x, y, width, height, footprint });
            }
          }
        }
      }

      for (const { footprint, ...object } of shuffle(candidates, random)) {
        if (solid) {
          for (const tile of footprint) tiles[tile] = FURNITURE;
          if (!roomStaysConnected(layout, room, freeTiles - footprint.length)) {
            for (const tile of footprint) tiles[tile] = 0;
            continue;
          }
          freeTiles -= footprint.length;
        }
        for (const tile of footprint) reserved.add(tile);
        objects.push({ ...object, kind, solid, fabric });
        break;
      }
    }
    return objects;
  }

  function createLayout(random, kind = choose(LAYOUTS, random), depth = 0) {
    const width = WIDTH + 4 * depth;
    const height = HEIGHT + 2 * depth;
    const tiles = new Uint8Array(width * height).fill(WALL);
    const roomsByTile = new Int8Array(tiles.length).fill(-1);
    const doorways = new Uint8Array(tiles.length);
    const reflectX = random() < 0.5;
    const reflectY = random() < 0.5;
    const centerlines = corridorPlan(kind, random, width, height).map(points => points.map(([x, y]) => [
      reflectX ? width - 1 - x : x,
      reflectY ? height - 1 - y : y,
    ]));
    const routes = centerlines.map((points, index) => carveCorridor(tiles, points, index === 0 ? 3 : 2, width));
    const layout = { kind, width, height, tiles, roomsByTile, doorways, routes };
    const rooms = createRooms(layout, depth, random);
    const sorted = rooms.slice().sort((a, b) => a.top - b.top || a.left - b.left);
    sorted.forEach((room, index) => { room.number = index + 1; });
    const furniture = rooms.flatMap(room => furnishRoom(layout, room, random));
    return { ...layout, rooms, furniture };
  }

  const map = {
    WIDTH, HEIGHT, WALL, FURNITURE, LAYOUTS, randomSource, choose, shuffle, tileAt, tileCenter,
    isWall, isSolid, walkableTiles, createLayout,
  };
  if (typeof module === 'object' && module.exports) module.exports = map;
  else root.DormMap = map;
})(globalThis);
