(function () {
  'use strict';

  const core = window.DormEscape;
  const audio = window.DormAudio.create();
  const dialogue = window.DormDialogue.create(document.getElementById('dialogue'), audio.playDialogue);
  const canvas = document.getElementById('scene');
  const context = canvas.getContext('2d', { alpha: false });
  const hud = document.getElementById('hud');
  const floorNumber = document.getElementById('floor');
  const objective = document.getElementById('objective');
  const stamina = document.getElementById('stamina');
  const staminaPercent = document.getElementById('stamina-percent');
  const fatigue = document.getElementById('fatigue');
  const alert = document.getElementById('alert');
  const transitionOverlay = document.getElementById('scene-transition');
  const floorAnnouncement = document.getElementById('floor-announcement');
  const screen = document.getElementById('screen');
  const screenTitle = document.getElementById('screen-title');
  const screenDescription = document.getElementById('screen-description');
  const startControls = document.getElementById('start-controls');
  const startButton = document.getElementById('start');
  const soundToggle = document.getElementById('sound-toggle');
  const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const floorColors = ['#47534a', '#49554b', '#455149'];
  const corridorColors = ['#333e38', '#354039', '#313c37'];
  const furnitureColors = {
    bunk: '#786e5d', wardrobe: '#74644e', desk: '#786348', books: '#575a43',
    sofa: '#687357', table: '#807050', seat: '#6a704a', plant: '#553d31',
  };
  const STEP = 1 / 60;
  const FULL_TURN = 2 * Math.PI;
  const BEAM_SAMPLE_ANGLE = Math.PI / 60;
  const LAYER_MAX_TILE_PIXELS = 64;
  const SCENE_PIXEL_BUDGET = 3_000_000;
  const GUARD_CUE_LIGHT = { range: 8, halfAngle: Math.PI };
  const EFFECT_MS = { floor: 1150, escaped: 820, caught: 680 };
  const OPENING_DIALOGUE = ['아... 개같은 학교 때려치워야지'];

  let game = core.createGame(17029);
  let seed;
  let view = 'start';
  let transition = null;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let previousFrame = 0;
  let accumulator = 0;
  let previousPose = null;
  let sceneLayer = null;
  let dirty = true;
  let sprintReleased = false;
  let soundEnabled = true;
  const keys = new Set();

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const detailRatio = Math.sqrt(SCENE_PIXEL_BUDGET / Math.max(1, width * height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, detailRatio));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    dirty = true;
  }

  function clearKeys() {
    keys.clear();
    sprintReleased = false;
    accumulator = 0;
    previousFrame = 0;
    previousPose = null;
  }

  function applySoundPreference() {
    audio.setEnabled(soundEnabled && !document.hidden);
  }

  function sprintHeld() {
    return keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  function input() {
    const controls = {
      x: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')),
      y: Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')),
      sprint: sprintHeld(),
      sprintReleased,
    };
    sprintReleased = false;
    return controls;
  }

  function startGame() {
    const firstStart = view === 'start';
    const nextSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    seed = nextSeed === seed ? (nextSeed + 1) >>> 0 : nextSeed;
    game = core.createGame(seed);
    clearKeys();
    view = 'playing';
    startButton.blur();
    screen.hidden = true;
    hud.hidden = false;
    dirty = true;
    updateHud();
    beginTransition('floor', performance.now(), firstStart ? () => showDialogue(OPENING_DIALOGUE) : null);
    const initialFloor = game.floor;
    audio.unlock().then(ready => {
      if (ready && game.floor === initialFloor && transition?.kind === 'floor') audio.play('floor');
    });
  }

  function showDialogue(lines) {
    dialogue.open(lines);
    if (!dialogue.active) return;
    clearKeys();
    hud.hidden = true;
    dirty = true;
  }

  function beginTransition(kind, time, onComplete = null) {
    transition = { kind, endsAt: time + EFFECT_MS[kind], onComplete };
    accumulator = 0;
    previousPose = null;
    dirty = true;
    transitionOverlay.dataset.effect = kind;
    transitionOverlay.style.setProperty('--effect-duration', `${EFFECT_MS[kind]}ms`);
    floorAnnouncement.textContent = kind === 'floor' ? `${game.floor.number}층` : '';
    floorAnnouncement.hidden = kind !== 'floor';
    transitionOverlay.hidden = false;
    if (kind !== 'floor') hud.hidden = true;
  }

  function showResult() {
    view = game.phase;
    clearKeys();
    hud.hidden = true;
    screen.dataset.screen = view;
    startControls.hidden = true;
    screenTitle.textContent = view === 'escaped' ? '탈출 성공' : '붙잡혔습니다';
    screenDescription.textContent = view === 'escaped'
      ? '1층 출구를 통과했습니다.'
      : `${game.floor.number}층에서 사감에게 붙잡혔습니다.`;
    startButton.textContent = '5층부터 다시 시작';
    screen.hidden = false;
    startButton.focus({ preventScroll: true });
    dirty = true;
  }

  function updateHud() {
    const number = String(game.floor.number);
    if (floorNumber.textContent !== number) {
      floorNumber.textContent = number;
      objective.textContent = number === '1' ? '1층 출구 찾기' : '아래층 계단 찾기';
    }
    stamina.value = game.player.stamina;
    const percent = `${Math.floor(game.player.stamina / core.MAX_STAMINA * 100)}%`;
    if (staminaPercent.textContent !== percent) staminaPercent.textContent = percent;
    stamina.parentElement.toggleAttribute('data-exhausted', game.player.exhausted);
    const fatigueMessage = game.player.exhausted ? '지침 · 회복 중' : game.player.sprintLocked ? 'Shift 키 놓기' : '';
    if (fatigue.textContent !== fatigueMessage) fatigue.textContent = fatigueMessage;
    fatigue.hidden = fatigueMessage === '';

    let status = '';
    const chased = game.floor.guards.some(guard => guard.mode === 'chase');
    if (chased) status = '발각됨 · 추격 중';
    else if (game.floor.guards.some(guard => guard.mode === 'search')) status = '발각됨 · 수색 중';
    const warning = !status && game.floor.guards.some(guard => guard.noticeTime > 0);
    if (warning) status = '발각 직전';
    hud.toggleAttribute('data-chase', chased);
    alert.toggleAttribute('data-warning', warning);
    if (alert.textContent !== status) alert.textContent = status;
    alert.hidden = status === '';
  }

  function wallCorners({tiles, width, height}) {
    const rows = Array.from({length: height + 1}, () => []);
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x <= width; x += 1) {
        const topLeft = core.isWall(tiles, x - 1, y - 1, width);
        const topRight = core.isWall(tiles, x, y - 1, width);
        const bottomLeft = core.isWall(tiles, x - 1, y, width);
        const bottomRight = core.isWall(tiles, x, y, width);
        if (topLeft === topRight && bottomLeft === bottomRight) continue;
        if (topLeft === bottomLeft && topRight === bottomRight) continue;
        rows[y].push(x);
      }
    }
    return rows;
  }

  function beamPath({tiles, width}, actor, light) {
    const angles = [];
    const samples = Math.ceil(2 * light.halfAngle / BEAM_SAMPLE_ANGLE);
    for (let index = 0; index <= samples; index += 1) {
      angles.push(light.halfAngle * (2 * index / samples - 1));
    }

    const { range } = light;
    const corners = sceneLayer.corners;
    const minY = Math.max(0, Math.ceil(actor.y - range));
    const maxY = Math.min(corners.length - 1, Math.floor(actor.y + range));
    const heading = Math.atan2(Math.sin(actor.angle), Math.cos(actor.angle));

    // Include both sides of wall corners so the edge of a shadow stays sharp.
    for (let y = minY; y <= maxY; y += 1) {
      for (const x of corners[y]) {
        const dx = x - actor.x;
        const dy = y - actor.y;
        if (dx * dx + dy * dy > range * range) continue;
        let relative = Math.atan2(dy, dx) - heading;
        if (relative > Math.PI) relative -= FULL_TURN;
        if (relative < -Math.PI) relative += FULL_TURN;
        if (Math.abs(relative) >= light.halfAngle - 0.0001) continue;
        angles.push(relative - 0.0001, relative, relative + 0.0001);
      }
    }

    const path = new Path2D();
    const fullCircle = light.halfAngle === Math.PI;
    if (!fullCircle) path.moveTo(actor.x, actor.y);
    for (const [index, relative] of angles.sort((first, second) => first - second).entries()) {
      const angle = actor.angle + relative;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const distance = core.castRay(tiles, actor.x, actor.y, dx, dy, range, core.isWall, width);
      const x = actor.x + dx * distance;
      const y = actor.y + dy * distance;
      if (fullCircle && index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  function drawFloor(context, floor, actor, range) {
    const { tiles, width, height } = floor;
    const minX = actor ? Math.max(1, Math.floor(actor.x - range)) : 1;
    const maxX = actor ? Math.min(width - 2, Math.floor(actor.x + range)) : width - 2;
    const minY = actor ? Math.max(1, Math.floor(actor.y - range)) : 1;
    const maxY = actor ? Math.min(height - 2, Math.floor(actor.y + range)) : height - 2;
    const edges = new Path2D();

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const tile = core.tileAt(x, y, width);
        if (core.isWall(tiles, x, y, width)) continue;
        const colors = floor.roomsByTile[tile] === -1 ? corridorColors : floorColors;
        context.fillStyle = colors[(x * 31 + y * 17) % colors.length];
        context.fillRect(x, y, 1, 1);
        context.fillStyle = '#0b18144a';
        context.fillRect(x, y, 1, 0.018);
        context.fillRect(x, y, 0.018, 1);

        const above = core.isWall(tiles, x, y - 1, width);
        const below = core.isWall(tiles, x, y + 1, width);
        const left = core.isWall(tiles, x - 1, y, width);
        const right = core.isWall(tiles, x + 1, y, width);

        if (floor.doorways[tile] === 1) {
          context.fillStyle = '#9d875d';
          if (above) context.fillRect(x + 0.31, y, 0.38, 0.11);
          if (below) context.fillRect(x + 0.31, y + 0.89, 0.38, 0.11);
        }
        if (floor.doorways[tile] === 2) {
          context.fillStyle = '#9d875d';
          if (left) context.fillRect(x, y + 0.31, 0.11, 0.38);
          if (right) context.fillRect(x + 0.89, y + 0.31, 0.11, 0.38);
        }

        if (above) {
          edges.moveTo(x, y + 0.045);
          edges.lineTo(x + 1, y + 0.045);
        }
        if (below) {
          edges.moveTo(x, y + 0.955);
          edges.lineTo(x + 1, y + 0.955);
        }
        if (left) {
          edges.moveTo(x + 0.045, y);
          edges.lineTo(x + 0.045, y + 1);
        }
        if (right) {
          edges.moveTo(x + 0.955, y);
          edges.lineTo(x + 0.955, y + 1);
        }
      }
    }

    context.lineWidth = 0.075;
    context.strokeStyle = '#849181';
    context.stroke(edges);
  }

  function drawFurniture(context, object) {
    const { kind, x, y, width, height, fabric, solid } = object;
    const length = Math.max(width, height);
    context.save();
    context.translate(x + width / 2, y + height / 2);
    if (height > width) context.rotate(Math.PI / 2);
    context.translate(-length / 2, -0.5);
    if (solid) {
      context.fillStyle = '#141d1a';
      context.fillRect(0.035, 0.035, length - 0.07, 0.93);
      context.fillStyle = furnitureColors[kind] || fabric;
      context.fillRect(0.09, 0.09, length - 0.18, 0.82);
      context.fillStyle = '#171e1a66';
      context.fillRect(0.09, 0.8, length - 0.18, 0.11);
    }

    if (kind === 'bunk') {
      context.fillStyle = '#c4c7ab';
      context.fillRect(0.22, 0.23, 0.39, 0.5);
      context.fillStyle = fabric;
      context.fillRect(0.7, 0.15, 1.09, 0.65);
      context.fillStyle = '#beb6a0';
      context.fillRect(0.7, 0.15, 0.055, 0.65);
      context.fillRect(1.36, 0.72, 0.035, 0.2);
      context.fillRect(1.58, 0.72, 0.035, 0.2);
      context.fillRect(1.36, 0.78, 0.255, 0.025);
      context.fillRect(1.36, 0.86, 0.255, 0.025);
    } else if (kind === 'wardrobe') {
      context.fillStyle = '#362e25';
      context.fillRect(0.48, 0.14, 0.04, 0.65);
      context.fillStyle = '#beb291';
      context.fillRect(0.36, 0.44, 0.045, 0.15);
      context.fillRect(0.59, 0.44, 0.045, 0.15);
    } else if (kind === 'desk') {
      context.fillStyle = '#c4b386';
      context.fillRect(0.22, 0.25, 0.48, 0.37);
      context.fillStyle = '#293830';
      context.fillRect(1.36, 0.22, 0.34, 0.44);
    } else if (kind === 'plant') {
      context.fillStyle = '#283e32';
      context.beginPath();
      context.arc(0.5, 0.5, 0.27, 0, FULL_TURN);
      context.fill();
      context.fillStyle = '#7c9662';
      for (const [leafX, leafY] of [[0.42, 0.38], [0.56, 0.43], [0.47, 0.58]]) {
        context.beginPath();
        context.arc(leafX, leafY, 0.105, 0, FULL_TURN);
        context.fill();
      }
    } else if (kind === 'books') {
      for (const [offset, color] of [[0.2, '#b29b6c'], [0.41, '#677e6d'], [0.62, '#916951']]) {
        context.fillStyle = color;
        context.fillRect(offset, 0.17, 0.15, 0.58);
      }
    } else if (kind === 'sofa' || kind === 'seat') {
      context.fillStyle = '#9aa289';
      context.fillRect(0.18, 0.2, length - 0.36, 0.14);
      context.fillStyle = '#3f4b37';
      context.fillRect(length / 2 - 0.025, 0.36, 0.05, 0.39);
    } else if (kind === 'suitcase' || kind === 'duffel') {
      context.fillStyle = '#212b27';
      context.fillRect(0.18, 0.23, 0.64, 0.085);
      context.fillRect(0.18, 0.64, 0.64, 0.085);
      context.strokeStyle = '#c5bca2';
      context.lineWidth = 0.045;
      context.strokeRect(0.4, 0.43, 0.2, 0.12);
    } else if (kind === 'rug') {
      context.fillStyle = fabric;
      context.fillRect(0.12, 0.19, length - 0.24, 0.62);
      context.fillStyle = '#c4b78a';
      context.fillRect(0.24, 0.19, 0.055, 0.62);
      context.fillRect(length - 0.295, 0.19, 0.055, 0.62);
    } else if (kind === 'shoes') {
      context.fillStyle = '#bca88f';
      context.fillRect(0.24, 0.39, 0.17, 0.35);
      context.fillRect(0.47, 0.35, 0.17, 0.35);
    }
    context.restore();
  }

  function buildSceneLayer(floor, tilePixels) {
    const layer = document.createElement('canvas');
    layer.width = floor.width * tilePixels;
    layer.height = floor.height * tilePixels;
    const target = layer.getContext('2d');
    target.scale(tilePixels, tilePixels);
    drawFloor(target, floor);
    for (const object of floor.furniture) drawFurniture(target, object);
    return { floor, layer, tilePixels, corners: wallCorners(floor) };
  }

  function drawSceneLayer(player) {
    const { range } = core.PLAYER_LIGHT;
    const { floor, layer, tilePixels } = sceneLayer;
    const left = Math.max(0, Math.floor(player.x - range));
    const top = Math.max(0, Math.floor(player.y - range));
    const columns = Math.min(floor.width, Math.ceil(player.x + range)) - left;
    const rows = Math.min(floor.height, Math.ceil(player.y + range)) - top;
    context.drawImage(layer, left * tilePixels, top * tilePixels, columns * tilePixels, rows * tilePixels,
      left, top, columns, rows);
  }

  function drawDialogueRoom(floor, player) {
    const tile = core.tileAt(player.x, player.y, floor.width);
    const room = floor.rooms[floor.roomsByTile[tile]];
    if (!room) return;

    context.save();
    context.beginPath();
    context.rect(room.left, room.top, room.width, room.height);
    context.clip();
    context.globalAlpha = 0.42;
    drawSceneLayer(player);
    context.restore();
  }

  function drawRoomLabels(floor, player) {
    const range = core.PLAYER_LIGHT.range + 1;
    context.font = '700 0.21px "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#c9ccae';
    for (const room of floor.rooms) {
      const first = core.tileCenter(room.entrance.wall[0], floor.width);
      const last = core.tileCenter(room.entrance.wall[1], floor.width);
      const x = (first.x + last.x) / 2;
      const y = (first.y + last.y) / 2;
      if (Math.abs(x - player.x) > range || Math.abs(y - player.y) > range) continue;
      const label = room.lounge ? '휴게실' : `${floor.number * 100 + room.number}호`;
      context.fillText(label, x, y);
    }
  }

  function drawGoal(floor) {
    const { x, y } = core.tileCenter(floor.goalTile, floor.width);
    const exit = floor.number === 1;
    const accent = exit ? '#a9e6b9' : '#f3d991';
    context.fillStyle = exit ? '#233e31' : '#423c28';
    context.fillRect(x - 0.43, y - 1.45, 0.86, 2.9);
    context.strokeStyle = accent;
    context.lineWidth = 0.025;
    context.strokeRect(x - 0.43, y - 1.45, 0.86, 2.9);
    context.beginPath();
    if (exit) {
      context.rect(x - 0.19, y - 0.26, 0.38, 0.49);
      context.moveTo(x + 0.06, y - 0.02);
      context.lineTo(x + 0.12, y - 0.02);
    } else {
      context.moveTo(x - 0.22, y - 0.2);
      context.lineTo(x - 0.09, y - 0.2);
      context.lineTo(x - 0.09, y - 0.07);
      context.lineTo(x + 0.04, y - 0.07);
      context.lineTo(x + 0.04, y + 0.06);
      context.lineTo(x + 0.17, y + 0.06);
      context.lineTo(x + 0.17, y + 0.18);
    }
    context.lineWidth = 0.05;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    context.fillStyle = accent;
    context.font = '700 0.25px "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(exit ? '출구' : '계단', x, y + 0.64);
  }

  function drawActor(actor, radius, fill, outline, lamp) {
    context.save();
    context.translate(actor.x, actor.y);
    context.rotate(actor.angle);
    context.fillStyle = '#07100e';
    context.beginPath();
    context.arc(0, 0, radius + 0.065, 0, FULL_TURN);
    context.fill();
    context.fillStyle = fill;
    context.strokeStyle = outline;
    context.lineWidth = 0.035;
    context.beginPath();
    context.arc(0, 0, radius, 0, FULL_TURN);
    context.fill();
    context.stroke();
    context.fillStyle = lamp;
    context.fillRect(radius - 0.07, -0.057, 0.16, 0.114);
    context.restore();
  }

  function createGuardLamp(floor, guard, light) {
    const beam = beamPath(floor, guard, light);
    const glow = context.createRadialGradient(guard.x, guard.y, 0, guard.x, guard.y, light.range);
    if (guard.mode === 'patrol') {
      glow.addColorStop(0, '#f5bf5f9c');
      glow.addColorStop(1, '#f5bf5f27');
    } else {
      glow.addColorStop(0, '#f77e5ab3');
      glow.addColorStop(1, '#f77e5a36');
    }
    return { guard, beam, glow };
  }

  function drawGuardLamps(lamps) {
    for (const { beam, glow } of lamps) {
      context.fillStyle = glow;
      context.fill(beam);
    }
  }

  function drawGuardCues(floor, player, lamps) {
    const observer = { x: player.x, y: player.y, angle: 0 };
    const sight = beamPath(floor, observer, GUARD_CUE_LIGHT);
    context.save();
    context.clip(sight);
    context.globalAlpha = 0.32;
    drawGuardLamps(lamps);

    context.globalAlpha = 0.82;
    context.fillStyle = '#ffdda1';
    for (const { guard } of lamps) {
      if (guard.mode !== 'patrol') continue;
      const source = {
        x: guard.x + Math.cos(guard.angle) * core.GUARD_RADIUS,
        y: guard.y + Math.sin(guard.angle) * core.GUARD_RADIUS,
      };
      if (!core.seesTarget(floor.tiles, observer, source, GUARD_CUE_LIGHT, floor.width)) continue;
      context.beginPath();
      context.arc(source.x, source.y, 0.067, 0, FULL_TURN);
      context.fill();
    }

    context.globalAlpha = 1;
    const range = GUARD_CUE_LIGHT.range;
    const fade = context.createRadialGradient(player.x, player.y, range - 1, player.x, player.y, range);
    fade.addColorStop(0, '#080d0d00');
    fade.addColorStop(1, '#080d0d');
    context.fillStyle = fade;
    context.fill(sight);
    context.restore();
  }

  function drawGuardPointer(x, y, direction, color) {
    context.save();
    context.translate(x, y);
    context.rotate(direction);
    context.beginPath();
    context.moveTo(11, 0);
    context.lineTo(-7, -7);
    context.lineTo(-7, 7);
    context.closePath();
    context.fillStyle = color;
    context.strokeStyle = '#131311';
    context.lineWidth = 3;
    context.stroke();
    context.fill();
    context.restore();
  }

  function drawTrackedGuards(guards, player, scale) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    for (const guard of guards) {
      if (guard.mode === 'patrol') continue;
      const dx = (guard.x - player.x) * scale;
      const dy = (guard.y - player.y) * scale;
      const chasing = guard.mode === 'chase';
      const color = chasing ? '#ffae95' : '#edcb91';
      if (Math.abs(dx) > halfWidth - 18 || Math.abs(dy) > halfHeight - 18) {
        const edgeX = Math.max(1, halfWidth - 26);
        const edgeY = Math.max(1, halfHeight - Math.min(92, height * 0.21));
        const edge = Math.min(edgeX / Math.abs(dx), edgeY / Math.abs(dy));
        drawGuardPointer(halfWidth + dx * edge, halfHeight + dy * edge, Math.atan2(dy, dx), color);
        continue;
      }

      context.save();
      context.translate(halfWidth + dx, halfHeight + dy);
      context.scale(scale, scale);
      drawActor({x: 0, y: 0, angle: guard.angle}, core.GUARD_RADIUS, '#664440', color, '#ffcb8a');
      context.beginPath();
      context.arc(0, 0, core.GUARD_RADIUS + 0.16, 0, FULL_TURN);
      context.strokeStyle = '#111615';
      context.lineWidth = 0.105;
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 0.045;
      if (!chasing) context.setLineDash([0.08, 0.055]);
      context.stroke();
      context.restore();
    }
  }

  function actorPose({ x, y, angle }) {
    return { x, y, angle };
  }

  function interpolatePose(actor, previous, fraction, rotate = false) {
    const x = previous.x + (actor.x - previous.x) * fraction;
    const y = previous.y + (actor.y - previous.y) * fraction;
    const difference = actor.angle - previous.angle;
    const angle = rotate ? previous.angle + Math.atan2(Math.sin(difference), Math.cos(difference)) * fraction : actor.angle;
    return { x, y, angle, mode: actor.mode };
  }

  function drawScene() {
    const { floor } = game;
    const fraction = Math.min(1, accumulator / STEP);
    const player = previousPose ? interpolatePose(game.player, previousPose.player, fraction) : game.player;
    const guards = previousPose ? floor.guards.map((guard, index) => (
      previousPose.guards[index] ? interpolatePose(guard, previousPose.guards[index], fraction, true) : guard
    )) : floor.guards;
    const intro = view === 'start';
    const scale = Math.max(24, Math.min(68, width / 19, height / 12));
    const tilePixels = Math.min(LAYER_MAX_TILE_PIXELS, Math.ceil(scale * pixelRatio));
    if (sceneLayer?.floor !== floor || sceneLayer.tilePixels !== tilePixels) sceneLayer = buildSceneLayer(floor, tilePixels);
    const focusX = intro ? width * 0.74 : width / 2;
    const focusY = intro ? height * 0.55 : height / 2;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = '#080d0d';
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(focusX - player.x * scale, focusY - player.y * scale);
    context.scale(scale, scale);

    if (intro) {
      context.globalAlpha = 0.18;
      drawFloor(context, floor, player, 14);
      context.globalAlpha = 1;
    }
    if (dialogue.active) drawDialogueRoom(floor, player);

    const cueRange = intro ? core.PLAYER_LIGHT.range : GUARD_CUE_LIGHT.range;
    const lamps = [];
    for (const guard of guards) {
      const light = core.guardLight(guard);
      if (Math.hypot(guard.x - player.x, guard.y - player.y) > cueRange + light.range) continue;
      lamps.push(createGuardLamp(floor, guard, light));
    }
    if (!intro && lamps.length > 0) drawGuardCues(floor, player, lamps);

    const playerBeam = beamPath(floor, player, core.PLAYER_LIGHT);
    context.save();
    context.clip(playerBeam);
    drawSceneLayer(player);
    drawRoomLabels(floor, player);

    const light = context.createRadialGradient(player.x, player.y, 0.1, player.x, player.y, core.PLAYER_LIGHT.range);
    light.addColorStop(0, '#fff0b945');
    light.addColorStop(0.58, '#dfd9a41b');
    light.addColorStop(1, '#070b0b95');
    context.fillStyle = light;
    context.fill(playerBeam);
    drawGoal(floor);

    drawGuardLamps(lamps);
    for (const { guard } of lamps) {
      if (guard.mode === 'patrol') drawActor(guard, core.GUARD_RADIUS, '#664440', '#e39883', '#ffcb8a');
    }
    context.restore();

    drawActor(player, core.PLAYER_RADIUS, '#a6c3ac', '#d0e4c8', '#fff0b7');
    context.restore();
    if (!intro) drawTrackedGuards(guards, player, scale);
  }

  function advance(time) {
    const elapsed = previousFrame === 0 ? 0 : Math.min(0.1, (time - previousFrame) / 1000);
    previousFrame = time;
    if (transition) {
      if (time >= transition.endsAt) {
        const { kind, onComplete } = transition;
        transition = null;
        transitionOverlay.hidden = true;
        if (kind !== 'floor') showResult();
        onComplete?.();
      }
      return;
    }
    if (dialogue.active) {
      dialogue.update(elapsed * 1000);
      return;
    }

    accumulator += elapsed;
    dirty = true;
    if (accumulator < STEP) return;
    while (accumulator >= STEP) {
      const { floor, player } = game;
      const { x, y, stamina: previousStamina } = player;
      previousPose = { player: actorPose(player), guards: floor.guards.map(actorPose) };
      core.step(game, input(), STEP);
      accumulator -= STEP;
      if (game.phase !== 'playing' || game.floor !== floor) {
        const kind = game.phase === 'playing' ? 'floor' : game.phase;
        beginTransition(kind, time);
        audio.play(kind);
        break;
      }
      audio.update({
        speed: Math.hypot(player.x - x, player.y - y) / STEP,
        sprinting: player.stamina < previousStamina,
        exhausted: player.exhausted,
        alerted: floor.guards.some(guard => guard.mode !== 'patrol'),
      }, STEP);
    }
    updateHud();
  }

  function frame(time) {
    if (view === 'playing' && !document.hidden) {
      advance(time);
    }
    if (dirty && width > 0 && height > 0) {
      drawScene();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', event => {
    if (dialogue.active) {
      if (movementKeys.has(event.code) || event.code === 'KeyA') event.preventDefault();
      if (event.code === 'KeyA' && !event.repeat) {
        dialogue.next();
        if (!dialogue.active) {
          clearKeys();
          hud.hidden = false;
        }
      }
      return;
    }
    if (view !== 'playing') {
      if (event.key === 'Enter' && !event.repeat && document.activeElement !== startButton && document.activeElement !== soundToggle) startGame();
      return;
    }
    if (!movementKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  });

  window.addEventListener('keyup', event => {
    keys.delete(event.code);
    if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !sprintHeld()) sprintReleased = true;
  });
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', () => {
    clearKeys();
    applySoundPreference();
  });
  window.addEventListener('resize', resize);
  startButton.addEventListener('click', startGame);
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    soundToggle.textContent = soundEnabled ? '소리 켜짐' : '소리 꺼짐';
    applySoundPreference();
  });
  resize();
  requestAnimationFrame(frame);
})();
