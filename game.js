(function () {
  'use strict';

  const core = window.DormEscape;
  const items = window.DormItems;
  const horror = window.DormHorror;
  const audio = window.DormAudio.create();
  const dialogue = window.DormDialogue.create(document.getElementById('dialogue'), audio.playDialogue);
  const canvas = document.getElementById('scene');
  const context = canvas.getContext('2d', { alpha: false });
  const hud = document.getElementById('hud');
  const floorNumber = document.getElementById('floor');
  const floorUnit = document.getElementById('floor-unit');
  const areaName = document.getElementById('area-name');
  const objective = document.getElementById('objective');
  const stamina = document.getElementById('stamina');
  const staminaPanel = stamina.parentElement;
  const staminaPercent = document.getElementById('stamina-percent');
  const fatigue = document.getElementById('fatigue');
  const itemHint = document.getElementById('item-hint');
  const itemEffects = document.getElementById('item-effects');
  const itemCard = document.getElementById('item-card');
  const itemName = itemCard.querySelector('.item-name');
  const itemDescription = itemCard.querySelector('.item-description');
  const itemPreview = itemCard.querySelector('canvas');
  const secretPrompt = document.getElementById('secret-prompt');
  const keypad = document.getElementById('keypad');
  const keypadDigits = document.getElementById('keypad-digits');
  const keypadMessage = document.getElementById('keypad-message');
  const keypadClose = document.getElementById('keypad-close');
  const scareScreen = document.getElementById('scare-screen');
  const inventorySlots = {
    passive: document.getElementById('passive-slot'),
    active: document.getElementById('active-slot'),
  };
  const alert = document.getElementById('alert');
  const transitionOverlay = document.getElementById('scene-transition');
  const floorAnnouncement = document.getElementById('floor-announcement');
  const screen = document.getElementById('screen');
  const screenTitle = document.getElementById('screen-title');
  const screenDescription = document.getElementById('screen-description');
  const escapeTime = document.getElementById('escape-time');
  const startControls = document.getElementById('start-controls');
  const startButton = document.getElementById('start');
  const soundToggle = document.getElementById('sound-toggle');
  const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const floorColors = ['#47534a', '#49554b', '#455149'];
  const corridorColors = ['#333e38', '#354039', '#313c37'];
  const furnitureColors = {
    bunk: '#786e5d', wardrobe: '#74644e', desk: '#786348', books: '#575a43',
    sofa: '#687357', table: '#807050', seat: '#6a704a', plant: '#553d31',
  };
  const STEP = 1 / 60;
  const FULL_TURN = 2 * Math.PI;
  const BEAM_SAMPLE_ANGLE = Math.PI / 30;
  const LAYER_MAX_TILE_PIXELS = 64;
  const LAYER_PIXEL_BUDGET = 4_000_000;
  const SCENE_PIXEL_BUDGET = 3_000_000;
  const GUARD_CUE_LIGHT = { range: 8, halfAngle: Math.PI, blocked: core.isSolid };
  const NEARBY_STAIR_SIGHT = { range: 2.4, halfAngle: Math.PI };
  const GAME_FONT = getComputedStyle(document.documentElement).getPropertyValue('--game-font');
  const EFFECT_MS = { floor: 1150, escaped: 820, caught: 680 };
  const BURST_DURATION = 0.55;
  const STAMINA_EFFECT_COLOR = '#b6e9ae';
  const SPEED_EFFECT_COLOR = '#95e5ee';
  const OPENING_DIALOGUE = ['아... 개같은 학교 때려치워야지'];
  const itemSprites = Object.fromEntries(Object.entries(items).map(([id, item]) => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 12;
    const pixels = sprite.getContext('2d');
    item.pixels.forEach((row, y) => {
      [...row].forEach((color, x) => {
        if (color === '.') return;
        pixels.fillStyle = item.palette[color];
        pixels.fillRect(x, y, 1, 1);
      });
    });
    return [id, sprite];
  }));
  const effectRows = new Map();

  let game = core.createGame(17029);
  let seed;
  let view = 'start';
  let transition = null;
  let startedAt = 0;
  let finishedAt = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let previousFrame = 0;
  let accumulator = 0;
  let previousPose = null;
  let sceneLayer = null;
  let dirty = true;
  let sprintReleased = false;
  let interactPressed = false;
  let enteredDigits = '';
  let soundEnabled = true;
  let nearbyPickup = null;
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
    interactPressed = false;
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
      interact: interactPressed,
    };
    sprintReleased = false;
    interactPressed = false;
    return controls;
  }

  function startGame() {
    const firstStart = view === 'start';
    startedAt = performance.now();
    finishedAt = 0;
    const nextSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    seed = nextSeed === seed ? (nextSeed + 1) >>> 0 : nextSeed;
    game = core.createGame(seed);
    view = 'playing';
    startButton.blur();
    screen.hidden = true;
    hud.hidden = false;
    dirty = true;
    beginTransition('floor', startedAt, firstStart ? () => showDialogue(OPENING_DIALOGUE) : null);
    updateHud();
    const initialFloor = game.floor;
    audio.unlock().then(ready => {
      if (ready && game.floor === initialFloor && transition?.kind === 'floor') audio.play('floor');
    });
  }

  function showDialogue(lines, onLine = null) {
    dialogue.open(lines, onLine);
    if (!dialogue.active) return;
    clearKeys();
    hud.hidden = true;
    dirty = true;
  }

  function placeTitle() {
    if (game.area === 'passage') return '비밀 통로';
    if (game.area === 'study') return '???';
    return `${game.floor.number}층`;
  }

  function beginTransition(kind, time, onComplete = null, name = placeTitle()) {
    transition = { kind, endsAt: time + EFFECT_MS[kind], onComplete };
    clearKeys();
    dirty = true;
    transitionOverlay.dataset.effect = kind;
    transitionOverlay.style.setProperty('--effect-duration', `${EFFECT_MS[kind]}ms`);
    floorAnnouncement.textContent = kind === 'floor' ? name : '';
    floorAnnouncement.hidden = kind !== 'floor';
    transitionOverlay.hidden = false;
    if (kind !== 'floor') hud.hidden = true;
  }

  function formatDuration(milliseconds) {
    const tenths = Math.floor(milliseconds / 100);
    const minutes = String(Math.floor(tenths / 600)).padStart(2, '0');
    const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
    return `${minutes}:${seconds}.${tenths % 10}`;
  }

  function showResult() {
    view = game.phase;
    clearKeys();
    hud.hidden = true;
    screen.dataset.screen = view;
    startControls.hidden = true;
    if (view === 'scared') {
      screenTitle.textContent = '???';
      screenDescription.textContent = '어둠 속에서 무언가가 다가왔습니다.';
    } else {
      screenTitle.textContent = view === 'escaped' ? '탈출 성공' : '붙잡혔습니다';
      screenDescription.textContent = view === 'escaped'
        ? '1층 출구를 통과했습니다.'
        : `${game.floor.number}층에서 사감 선생님께 붙잡혔습니다.`;
    }
    escapeTime.textContent = view === 'escaped' ? `소요 시간 ${formatDuration(finishedAt - startedAt)}` : '';
    escapeTime.hidden = view !== 'escaped';
    startButton.textContent = '5층부터 다시 시작';
    screen.hidden = false;
    startButton.focus({ preventScroll: true });
    dirty = true;
  }

  function showScare() {
    view = 'scared';
    clearKeys();
    hud.hidden = true;
    scareScreen.hidden = false;
    audio.play('scared');
    let enteredFullscreen = false;
    if (!document.fullscreenElement && document.fullscreenEnabled && navigator.userActivation?.isActive) {
      document.documentElement.requestFullscreen().then(() => { enteredFullscreen = true; }, () => {});
    }
    setTimeout(() => {
      audio.stopScare();
      window.close();
      setTimeout(() => {
        if (window.closed) return;
        if (enteredFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        scareScreen.hidden = true;
        showResult();
      }, 100);
    }, 2000);
  }

  function renderKeypad(message = '') {
    keypadDigits.textContent = [...enteredDigits.padEnd(4, '·')].join(' ');
    keypadMessage.textContent = message;
  }

  function openKeypad() {
    enteredDigits = '';
    renderKeypad();
    clearKeys();
    secretPrompt.hidden = true;
    keypad.showModal();
  }

  function closeKeypad() {
    game.keypadOpen = false;
    keypad.close();
    clearKeys();
    updateHud();
  }

  function enterDigit(digit) {
    enteredDigits += digit;
    if (enteredDigits.length < 4) {
      renderKeypad();
      return;
    }
    if (!core.openSecretPassage(game, enteredDigits)) {
      enteredDigits = '';
      renderKeypad('비밀번호가 맞지 않습니다.');
      return;
    }
    keypad.close();
    beginTransition('floor', performance.now());
    updateHud();
    audio.play('floor');
  }

  function updateHud() {
    const special = game.area === 'study' || game.area === 'passage';
    const name = special ? placeTitle() : String(game.floor.number);
    if (floorNumber.textContent !== name) floorNumber.textContent = name;
    floorNumber.parentElement.toggleAttribute('data-location', special);
    floorUnit.hidden = special;
    areaName.hidden = game.area !== 'girls';
    if (!areaName.hidden && areaName.textContent !== '여자 기숙사') areaName.textContent = '여자 기숙사';
    const goal = game.area === 'study' ? '' : game.area === 'passage' ? '나가는 문 찾기' :
      game.floor.number === 1 ? '1층 출구 찾기' : '아래층 계단 찾기';
    if (objective.textContent !== goal) objective.textContent = goal;
    const maximum = core.maxStamina(game);
    if (stamina.max !== maximum) stamina.max = maximum;
    if (stamina.value !== game.player.stamina) stamina.value = game.player.stamina;
    const percent = `${Math.floor(game.player.stamina / maximum * 100)}%`;
    if (staminaPercent.textContent !== percent) staminaPercent.textContent = percent;
    staminaPanel.toggleAttribute('data-exhausted', game.player.exhausted);
    staminaPanel.toggleAttribute('data-recovering', game.player.recovering);
    staminaPanel.toggleAttribute('data-restored', burstActive(game.player.staminaRestoredAt));
    const fatigueMessage = game.player.exhausted ? '지침 · 회복 중' : game.player.sprintLocked ? 'Shift 키 놓기' : '';
    if (fatigue.textContent !== fatigueMessage) fatigue.textContent = fatigueMessage;
    fatigue.hidden = fatigueMessage === '';

    let status = '';
    const detected = game.cameraAlertUntil > game.time ? 'CCTV에 발각됨' : '발각됨';
    const chased = game.floor.guards.some(guard => guard.mode === 'chase');
    if (chased) status = `${detected} · 추격 중`;
    else if (game.floor.guards.some(guard => guard.mode === 'search')) status = `${detected} · 수색 중`;
    const warning = !status && game.floor.guards.some(guard => guard.noticeTime > 0);
    if (warning) status = '발각 직전';
    hud.toggleAttribute('data-chase', chased);
    alert.toggleAttribute('data-warning', warning);
    if (alert.textContent !== status) alert.textContent = status;
    alert.hidden = status === '';
    updateEffectHud();
    updateItemHud();
  }

  function setItemIcon(iconCanvas, id) {
    const icon = iconCanvas.getContext('2d');
    icon.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
    if (id) icon.drawImage(itemSprites[id], 0, 0);
  }

  function effectOnFloor(effect) {
    return effect.floorNumber === null || effect.floorNumber === game.floor.number;
  }

  function effectColor(id, key) {
    return key === 'exhausted' ? '#f3a488' : items[id].feedback?.color ?? '#e0ca87';
  }

  function updateEffectHud() {
    const held = core.heldItem(game);
    const visible = [];
    if (held) {
      const key = items[held.id].feedback?.sprint && game.player.sprinting ? 'sprint' : 'held';
      visible.push({ id: held.id, key, held: true });
    }
    for (const effect of game.itemEffects.values()) {
      if (effectOnFloor(effect)) visible.push(effect);
    }
    itemEffects.hidden = visible.length === 0;
    if (!visible.length && !effectRows.size) return;
    const showing = new Set();
    for (const effect of visible) {
      const { id, key } = effect;
      const rowKey = `${id}:${key}`;
      showing.add(rowKey);
      let row = effectRows.get(rowKey);
      if (!row) {
        const item = items[id];
        const entry = document.createElement('li');
        entry.className = 'item-effect';
        entry.title = item.name;
        entry.style.setProperty('--effect-color', effectColor(id, key));
        const icon = document.createElement('canvas');
        icon.width = icon.height = 12;
        icon.setAttribute('aria-hidden', 'true');
        setItemIcon(icon, id);
        const label = document.createElement('span');
        label.textContent = item.feedback?.[key] ?? `${item.name} ${effect.held ? '효과 적용' : '사용'}`;
        const remaining = document.createElement('span');
        remaining.className = 'item-effect-time';
        remaining.setAttribute('aria-hidden', 'true');
        remaining.hidden = !effect.timed;
        entry.append(icon, label, remaining);
        if (effect.held) itemEffects.prepend(entry);
        else itemEffects.append(entry);
        row = { entry, remaining };
        effectRows.set(rowKey, row);
      }
      if (effect.timed) {
        const seconds = `${Math.ceil(effect.until - game.time - 1e-9)}초`;
        if (row.remaining.textContent !== seconds) row.remaining.textContent = seconds;
      }
    }
    for (const [key, row] of effectRows) {
      if (showing.has(key)) continue;
      row.entry.remove();
      effectRows.delete(key);
    }
  }

  function updateItemHud() {
    for (const [type, slot] of Object.entries(inventorySlots)) {
      const id = game.inventory[type]?.id ?? '';
      if (slot.dataset.item === id) continue;
      const icon = slot.querySelector('canvas');
      const label = type === 'passive' ? '패시브' : '액티브';
      slot.dataset.item = id;
      slot.toggleAttribute('data-filled', Boolean(id));
      slot.setAttribute('aria-label', `${label} ${id ? items[id].name : '빈 칸'}`);
      icon.hidden = !id;
      setItemIcon(icon, id);
    }

    nearbyPickup = transition ? null : core.nearbyItem(game);
    const preview = game.dismissedPickup ? null : nearbyPickup;
    itemCard.hidden = !preview;
    secretPrompt.hidden = Boolean(transition || nearbyPickup || game.keypadOpen || !core.nearbySecret(game));
    itemHint.hidden = Boolean(transition) || game.useHintUntil <= game.time;
    if (!preview) return;
    if (itemCard.dataset.item === preview.id) return;
    itemCard.dataset.item = preview.id;
    itemName.textContent = items[preview.id].name;
    itemDescription.textContent = items[preview.id].description;
    setItemIcon(itemPreview, preview.id);
  }

  function obstacleCorners({tiles, width, height}, blocked) {
    const rows = Array.from({length: height + 1}, () => []);
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x <= width; x += 1) {
        const topLeft = blocked(tiles, x - 1, y - 1, width);
        const topRight = blocked(tiles, x, y - 1, width);
        const bottomLeft = blocked(tiles, x - 1, y, width);
        const bottomRight = blocked(tiles, x, y, width);
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

    const { range, blocked = core.isWall } = light;
    const corners = blocked === core.isSolid ? sceneLayer.solidCorners : sceneLayer.wallCorners;
    const minY = Math.max(0, Math.ceil(actor.y - range));
    const maxY = Math.min(corners.length - 1, Math.floor(actor.y + range));
    const fullCircle = light.halfAngle === Math.PI;
    const facing = fullCircle ? 0 : actor.angle;
    const heading = Math.atan2(Math.sin(facing), Math.cos(facing));

    // Include both sides of obstacle corners so the edge of a shadow stays sharp.
    for (let y = minY; y <= maxY; y += 1) {
      for (const x of corners[y]) {
        const dx = x - actor.x;
        const dy = y - actor.y;
        if (dx * dx + dy * dy > range * range) continue;
        let relative = Math.atan2(dy, dx) - heading;
        if (relative > Math.PI) relative -= FULL_TURN;
        if (relative < -Math.PI) relative += FULL_TURN;
        if (!fullCircle && Math.abs(relative) >= light.halfAngle - 0.0001) continue;
        angles.push(relative - 0.0001, relative, relative + 0.0001);
      }
    }

    const path = new Path2D();
    if (!fullCircle) path.moveTo(actor.x, actor.y);
    for (const [index, relative] of angles.sort((first, second) => first - second).entries()) {
      const angle = facing + relative;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const distance = core.castRay(tiles, actor.x, actor.y, dx, dy, range, blocked, width);
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
    drawRoomLabels(target, floor);
    return {
      floor, layer, tilePixels,
      wallCorners: obstacleCorners(floor, core.isWall),
      solidCorners: obstacleCorners(floor, core.isSolid),
    };
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

  function drawRoomLabels(target, floor) {
    target.font = `700 0.25px ${GAME_FONT}`;
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.fillStyle = '#c9ccae';
    for (const room of floor.rooms) {
      const first = core.tileCenter(room.entrance.wall[0], floor.width);
      const last = core.tileCenter(room.entrance.wall[1], floor.width);
      const x = (first.x + last.x) / 2;
      const y = (first.y + last.y) / 2;
      let label = `${floor.number * 100 + room.number}호`;
      if (room.lounge) label = '휴게실';
      else if (room.id === floor.homeRoomId) label = '내 방';
      target.fillText(label, x, y);
    }
  }

  function drawStairSign(floor, player, playerBeam, tile, kind) {
    if (tile === null) return;
    const marker = core.tileCenter(tile, floor.width);
    const { x, y } = marker;
    if (Math.hypot(x - player.x, y - player.y) > core.PLAYER_LIGHT.range + 1.5) return;
    const exit = kind === 'exit';
    const up = kind === 'up';
    const accent = exit ? '#a9e6b9' : up ? '#a5ddec' : '#f3d991';
    const signHeight = up ? 0.92 : 2.9;
    context.save();
    if (!core.seesTarget(floor.tiles, player, marker, NEARBY_STAIR_SIGHT, floor.width)) context.clip(playerBeam);
    context.fillStyle = exit ? '#233e31' : up ? '#203946' : '#423c28';
    context.fillRect(x - 0.43, y - signHeight / 2, 0.86, signHeight);
    context.strokeStyle = accent;
    context.lineWidth = 0.025;
    context.strokeRect(x - 0.43, y - signHeight / 2, 0.86, signHeight);
    context.beginPath();
    if (exit) {
      context.rect(x - 0.19, y - 0.26, 0.38, 0.49);
      context.moveTo(x + 0.06, y - 0.02);
      context.lineTo(x + 0.12, y - 0.02);
    } else {
      const tip = y + (up ? -0.32 : 0.25);
      const shoulder = tip + (up ? 0.19 : -0.19);
      context.moveTo(x, y + (up ? 0.06 : -0.32));
      context.lineTo(x, tip);
      context.moveTo(x - 0.2, shoulder);
      context.lineTo(x, tip);
      context.lineTo(x + 0.2, shoulder);
    }
    context.lineWidth = 0.05;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    context.fillStyle = accent;
    context.font = `700 0.32px ${GAME_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(exit ? '출구' : up ? '위층' : '아래층', x, y + (up ? 0.26 : 0.61), 0.73);
    context.restore();
  }

  function drawPassageDoor(floor, player, beam, marker, exit = false) {
    const { x, y } = marker;
    if (Math.hypot(x - player.x, y - player.y) > core.PLAYER_LIGHT.range + 1) return;
    const accent = exit ? '#b5dcb6' : '#c7abdf';
    context.save();
    if (!core.seesTarget(floor.tiles, player, marker, NEARBY_STAIR_SIGHT, floor.width)) context.clip(beam);
    context.fillStyle = '#111a18';
    context.fillRect(x - 0.43, y - 0.46, 0.86, 0.92);
    context.lineWidth = 0.035;
    context.strokeStyle = accent;
    context.strokeRect(x - 0.42, y - 0.45, 0.84, 0.9);
    context.fillStyle = exit ? '#314d42' : '#3a3046';
    context.fillRect(x - 0.28, y - 0.36, 0.56, 0.5);
    context.fillStyle = accent;
    context.fillRect(x + 0.13, y - 0.14, 0.07, 0.06);
    if (!exit) {
      context.fillRect(x + 0.31, y - 0.26, 0.055, 0.055);
      context.fillRect(x + 0.31, y - 0.17, 0.055, 0.055);
      context.fillRect(x + 0.31, y - 0.08, 0.055, 0.055);
    }
    context.font = `700 0.22px ${GAME_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(exit ? '나가는 문' : '비밀 통로', x, y + 0.28, 0.75);
    context.restore();
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

  function drawGroundItem({ id, x, y }, nearby) {
    context.fillStyle = '#131915';
    context.fillRect(x - 0.27, y + 0.12, 0.54, 0.15);
    context.fillStyle = nearby ? '#e0ca87' : '#8a8054';
    context.fillRect(x - 0.18, y + 0.23, 0.36, 0.035);
    context.imageSmoothingEnabled = false;
    context.drawImage(itemSprites[id], x - 0.3, y - 0.36, 0.6, 0.6);
    context.imageSmoothingEnabled = true;
  }

  function drawCrumbs(floor, player, range) {
    if (floor.crumbs.size === 0) return;
    const left = Math.max(0, Math.floor((player.x - range) * 2));
    const right = Math.min(floor.width * 2 - 1, Math.floor((player.x + range) * 2));
    const top = Math.max(0, Math.floor((player.y - range) * 2));
    const bottom = Math.min(floor.height * 2 - 1, Math.floor((player.y + range) * 2));
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const crumb = floor.crumbs.get(core.tileAt(column, row, floor.width * 2));
        if (!crumb) continue;
        const { x, y } = crumb;
        context.fillStyle = '#efc280';
        context.fillRect(x - 0.035, y - 0.035, 0.07, 0.07);
        context.fillStyle = '#b38654';
        context.fillRect(x + 0.055, y + 0.04, 0.045, 0.045);
      }
    }
  }

  function drawItemRoute() {
    if (!core.hasItemRoute(game)) return;
    const { floor, player } = game;
    const tile = core.tileAt(player.x, player.y, floor.width);
    if (sceneLayer.guide?.tile !== tile) {
      const points = core.itemRoute(game);
      const path = new Path2D();
      if (points.length > 1) {
        path.moveTo(points[0].x, points[0].y);
        for (const { x, y } of points.slice(1)) path.lineTo(x, y);
      }
      sceneLayer.guide = { tile, path };
    }
    context.save();
    context.setLineDash([0.16, 0.18]);
    context.lineWidth = 0.055;
    context.strokeStyle = '#7bcdd5b8';
    context.stroke(sceneLayer.guide.path);
    context.restore();
  }

  function drawShot() {
    if (!game.shot) return;
    const { from, to, startedAt } = game.shot;
    const progress = (game.time - startedAt) / core.SHOT_DURATION;
    if (progress >= 1) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const flight = Math.min(1, progress / 0.62);
    if (progress < 0.3) {
      context.save();
      context.translate(from.x, from.y);
      context.rotate(Math.atan2(dy, dx));
      context.fillStyle = '#fae0a8';
      context.fillRect(0.22, -0.045, 0.24 - progress * 0.25, 0.09);
      context.restore();
    }
    context.save();
    if (flight < 1) {
      const trail = Math.max(0, flight - 0.13);
      context.beginPath();
      context.moveTo(from.x + dx * trail, from.y + dy * trail);
      context.lineTo(from.x + dx * flight, from.y + dy * flight);
      context.lineWidth = 0.055;
      context.strokeStyle = '#ffe3a6';
      context.stroke();
    } else {
      context.globalAlpha = (1 - progress) / 0.38;
      context.fillStyle = '#ffd288';
      for (const [x, y] of [[0, -0.26], [0.23, -0.1], [-0.21, 0.13], [0.13, 0.22]]) {
        context.fillRect(to.x + x * progress, to.y + y * progress, 0.075, 0.075);
      }
    }
    context.restore();
  }

  function burstActive(startedAt) {
    return Number.isFinite(startedAt) && game.time - startedAt < BURST_DURATION;
  }

  function drawEffectBurst(startedAt, color, offset) {
    const progress = (game.time - startedAt) / BURST_DURATION;
    const radius = 0.29 + progress * 0.48;
    context.globalAlpha = 1 - progress;
    context.fillStyle = color;
    for (let index = 0; index < 8; index += 1) {
      const angle = offset + index * FULL_TURN / 8;
      const size = (index % 2 === 0 ? 0.08 : 0.055) * (1 - progress * 0.55);
      context.fillRect(Math.cos(angle) * radius - size / 2, Math.sin(angle) * radius - size / 2, size, size);
    }
  }

  function drawPlayerEffects(player) {
    if (reducedMotion.matches) return;
    const current = game.player;
    context.save();
    context.translate(player.x, player.y);
    const previous = previousPose?.player;
    if (current.speedBoosted && previous && (current.x !== previous.x || current.y !== previous.y)) {
      context.save();
      context.rotate(player.angle);
      const phase = (game.time * 5) % 1;
      context.fillStyle = SPEED_EFFECT_COLOR;
      context.globalAlpha = 0.8 - phase * 0.45;
      context.fillRect(-0.51 - phase * 0.27, -0.14, 0.23 - phase * 0.09, 0.04);
      context.fillRect(-0.45 - phase * 0.19, 0.09, 0.19 - phase * 0.06, 0.035);
      context.fillRect(-0.61 - phase * 0.23, 0.23, 0.16 - phase * 0.07, 0.032);
      context.restore();
    }

    if (burstActive(current.staminaRestoredAt)) {
      drawEffectBurst(current.staminaRestoredAt, STAMINA_EFFECT_COLOR, Math.PI / 8);
    }
    const held = core.heldItem(game);
    if (burstActive(held?.pickedUpAt)) drawEffectBurst(held.pickedUpAt, effectColor(held.id, 'held'), 0);
    for (const effect of game.itemEffects.values()) {
      if (effectOnFloor(effect) && burstActive(effect.startedAt)) {
        drawEffectBurst(effect.startedAt, effectColor(effect.id, effect.key), 0);
      }
    }
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

  function drawCameraScans(cameras) {
    for (const { beam, triggered } of cameras) {
      if (!beam) continue;
      context.fillStyle = triggered ? '#da655364' : '#5fbab747';
      context.fill(beam);
      context.strokeStyle = triggered ? '#f7836b88' : '#87d5d270';
      context.lineWidth = 0.025;
      context.stroke(beam);
    }
  }

  function drawCameras(cameras) {
    for (const { x, y, angle, beam, triggered, nearby } of cameras) {
      if (!nearby) continue;
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.fillStyle = '#091515';
      context.fillRect(-0.21, -0.13, 0.46, 0.26);
      context.fillStyle = '#6d827f';
      context.fillRect(-0.16, -0.09, 0.3, 0.18);
      context.fillStyle = triggered ? '#ffa18e' : beam ? '#a3e7de' : '#475653';
      context.fillRect(0.14, -0.065, 0.1, 0.13);
      context.restore();
    }
  }

  function drawNearbyLights(floor, player, sight, lamps, cameras) {
    context.save();
    context.clip(sight);
    context.globalAlpha = 0.32;
    drawGuardLamps(lamps);

    drawCameraScans(cameras);
    context.globalAlpha = 0.82;
    context.fillStyle = '#ffdda1';
    for (const { guard } of lamps) {
      if (guard.mode !== 'patrol') continue;
      const source = {
        x: guard.x + Math.cos(guard.angle) * core.GUARD_RADIUS,
        y: guard.y + Math.sin(guard.angle) * core.GUARD_RADIUS,
      };
      if (!core.seesTarget(floor.tiles, player, source, GUARD_CUE_LIGHT, floor.width)) continue;
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
    return { x, y, angle, mode: actor.mode, stunnedUntil: actor.stunnedUntil };
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
    const focusX = intro ? width * 0.74 : width / 2;
    const focusY = intro ? height * 0.55 : height / 2;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = '#080d0d';
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(focusX - player.x * scale, focusY - player.y * scale);
    context.scale(scale, scale);

    if (game.area === 'study') {
      const brightness = reducedMotion.matches && game.study.scareAt !== null ? 0.56 : game.study.dimmed ? 0.22 : 1;
      horror.drawStudy(context, player, core.PLAYER_LIGHT, brightness, core.isStudyDesk);
      drawActor(player, core.PLAYER_RADIUS, '#a6c3ac', '#d0e4c8', '#fff0b7');
      context.restore();
      return;
    }

    const layerLimit = Math.floor(Math.sqrt(LAYER_PIXEL_BUDGET / (floor.width * floor.height)));
    const tilePixels = Math.min(LAYER_MAX_TILE_PIXELS, Math.ceil(scale * pixelRatio), layerLimit);
    if (sceneLayer?.floor !== floor || sceneLayer.tilePixels !== tilePixels) sceneLayer = buildSceneLayer(floor, tilePixels);

    if (intro) {
      context.globalAlpha = 0.18;
      drawFloor(context, floor, player, 14);
      context.globalAlpha = 1;
    }
    if (dialogue.active) drawDialogueRoom(floor, player);

    const cueRange = intro ? core.PLAYER_LIGHT.range : GUARD_CUE_LIGHT.range;
    const lamps = [];
    for (const guard of guards) {
      const light = core.guardLight(guard, floor, game.time);
      if (!light) continue;
      if (Math.hypot(guard.x - player.x, guard.y - player.y) > cueRange + light.range) continue;
      lamps.push(createGuardLamp(floor, guard, light));
    }
    const playerLight = core.playerLight(game);
    const cached = sceneLayer.playerPaths;
    if (!cached || cached.x !== player.x || cached.y !== player.y || cached.angle !== player.angle || cached.light !== playerLight) {
      sceneLayer.playerPaths = { x: player.x, y: player.y, angle: player.angle, light: playerLight, beam: beamPath(floor, player, playerLight) };
    }
    const paths = sceneLayer.playerPaths;
    const playerBeam = paths.beam;
    const cameras = [];
    const cameraTime = previousPose ? game.time - STEP * (1 - fraction) : game.time;
    const scan = core.CAMERA_SCAN;
    const enabled = floor.empUntil <= game.time;
    for (const camera of floor.cameras) {
      if (Math.hypot(camera.x - player.x, camera.y - player.y) > cueRange + scan.range) continue;
      const pose = { x: camera.x, y: camera.y, angle: core.cameraAngle(camera, cameraTime) };
      cameras.push({
        ...pose,
        beam: enabled ? beamPath(floor, pose, scan) : null,
        triggered: game.alertCamera === camera && game.cameraAlertUntil > game.time,
        nearby: core.seesTarget(floor.tiles, player, camera, GUARD_CUE_LIGHT, floor.width),
      });
    }
    if (!intro && (lamps.length || cameras.some(camera => camera.beam))) {
      paths.sight ??= beamPath(floor, player, GUARD_CUE_LIGHT);
      drawNearbyLights(floor, player, paths.sight, lamps, cameras);
    }

    context.save();
    context.clip(playerBeam);
    drawSceneLayer(player);

    const light = context.createRadialGradient(player.x, player.y, 0.1, player.x, player.y, playerLight.range);
    const circularLight = playerLight.halfAngle === Math.PI;
    light.addColorStop(0, circularLight ? '#dbf5ac55' : '#fff0b945');
    light.addColorStop(0.58, circularLight ? '#a9d49326' : '#dfd9a41b');
    light.addColorStop(1, '#070b0b95');
    context.fillStyle = light;
    context.fill(playerBeam);
    drawGuardLamps(lamps);
    drawCameraScans(cameras);
    if (!intro) {
      drawCrumbs(floor, player, playerLight.range);
      for (const item of floor.pickups) {
        if (item !== nearbyPickup) drawGroundItem(item, false);
      }
    }
    for (const guard of guards) {
      if (guard.mode !== 'patrol') continue;
      const lamp = core.guardLight(guard, floor, game.time) ? '#ffcb8a' : '#363531';
      drawActor(guard, core.GUARD_RADIUS, '#664440', '#e39883', lamp);
      if (guard.stunnedUntil > game.time) {
        context.fillStyle = '#ffd288';
        context.fillRect(guard.x - 0.09, guard.y - 0.39, 0.05, 0.05);
        context.fillRect(guard.x + 0.04, guard.y - 0.46, 0.055, 0.055);
      }
    }
    context.restore();

    if (game.area === 'passage') {
      drawPassageDoor(floor, player, playerBeam, core.tileCenter(floor.goalTile, floor.width), true);
    } else {
      drawStairSign(floor, player, playerBeam, floor.goalTile, floor.number === 1 ? 'exit' : 'down');
      drawStairSign(floor, player, playerBeam, floor.upTile, 'up');
      if (floor.secret) drawPassageDoor(floor, player, playerBeam, floor.secret);
      drawItemRoute();
    }
    drawCameras(cameras);
    if (nearbyPickup) drawGroundItem(nearbyPickup, true);
    if (!intro && !dialogue.active) drawPlayerEffects(player);
    drawActor(player, core.PLAYER_RADIUS, '#a6c3ac', '#d0e4c8', '#fff0b7');
    drawShot();
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
    if (keypad.open) return;

    accumulator += elapsed;
    dirty = true;
    if (accumulator < STEP) return;
    while (accumulator >= STEP) {
      const { area, floor, player } = game;
      const { x, y } = player;
      previousPose = { player: actorPose(player), guards: floor.guards.map(actorPose) };
      core.step(game, input(), STEP);
      accumulator -= STEP;
      if (game.phoneCall) {
        showDialogue(game.phoneCall.lines, index => core.revealPhoneLine(game, index));
        break;
      }
      if (game.keypadOpen) {
        openKeypad();
        break;
      }
      if (game.phase === 'scared') {
        showScare();
        break;
      }
      if (game.phase !== 'playing' || game.floor !== floor) {
        const kind = game.phase === 'playing' ? 'floor' : game.phase;
        if (kind === 'escaped') finishedAt = time;
        const name = area === 'passage' && game.area === 'girls' ? `여자 기숙사 · ${placeTitle()}` : placeTitle();
        beginTransition(kind, time, null, name);
        audio.play(kind);
        break;
      }
      audio.update({
        speed: Math.hypot(player.x - x, player.y - y) / STEP,
        sprinting: player.sprinting,
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
    if (keypad.open) {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        if (!event.repeat) enterDigit(event.key);
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        enteredDigits = event.key === 'Backspace' ? enteredDigits.slice(0, -1) : '';
        renderKeypad();
      }
      return;
    }
    const interact = event.code === 'Space';
    if (interact && event.target === soundToggle) return;
    if (dialogue.active) {
      if (movementKeys.has(event.code) || interact) event.preventDefault();
      if (interact && !event.repeat) {
        dialogue.next();
        if (!dialogue.active) {
          game.phoneCall = null;
          clearKeys();
          hud.hidden = false;
        }
      }
      return;
    }
    if (view !== 'playing') {
      if (!scareScreen.hidden) return;
      if (event.key === 'Enter' && !event.repeat && document.activeElement !== startButton && document.activeElement !== soundToggle) startGame();
      return;
    }
    if (!movementKeys.has(event.code) && !interact) return;
    event.preventDefault();
    if (transition || event.repeat) return;
    if (interact) interactPressed = true;
    else keys.add(event.code);
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
  keypad.addEventListener('click', event => {
    const { digit, keypad: action } = event.target.dataset;
    if (digit !== undefined) enterDigit(digit);
    else if (action) {
      enteredDigits = action === 'back' ? enteredDigits.slice(0, -1) : '';
      renderKeypad();
    }
  });
  keypad.addEventListener('cancel', event => {
    event.preventDefault();
    closeKeypad();
  });
  keypadClose.addEventListener('click', closeKeypad);
  startButton.addEventListener('click', startGame);
  soundToggle.addEventListener('click', event => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    soundToggle.textContent = soundEnabled ? '소리 켜짐' : '소리 꺼짐';
    applySoundPreference();
    if (view === 'playing' && event.detail > 0) soundToggle.blur();
  });
  resize();
  document.fonts.load('20px LeeSeoyun').then(() => {
    sceneLayer = null;
    dirty = true;
  }, () => {});
  requestAnimationFrame(frame);
})();
