(function (root) {
  'use strict';

  function drawStudy(context, player, light, brightness, isDesk) {
    const sector = new Path2D();
    sector.moveTo(player.x, player.y);
    sector.arc(player.x, player.y, light.range, player.angle - light.halfAngle, player.angle + light.halfAngle);
    sector.closePath();
    const left = Math.floor(player.x - light.range);
    const top = Math.floor(player.y - light.range);
    const right = Math.ceil(player.x + light.range);
    const bottom = Math.ceil(player.y + light.range);
    context.save();
    context.clip(sector);
    context.globalAlpha = brightness;
    context.fillStyle = '#333d39';
    context.fillRect(left, top, right - left, bottom - top);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        context.fillStyle = '#242f2b';
        context.fillRect(x, y, 1, 0.018);
        context.fillRect(x, y, 0.018, 1);
        if (!isDesk(x, y)) continue;
        context.fillStyle = '#1c241f';
        context.fillRect(x + 0.06, y + 0.08, 0.88, 0.87);
        context.fillStyle = '#827153';
        context.fillRect(x + 0.08, y + 0.09, 0.84, 0.7);
        context.fillStyle = '#9f8d65';
        context.fillRect(x + 0.11, y + 0.12, 0.78, 0.09);
        context.fillStyle = '#575141';
        context.fillRect(x + 0.11, y + 0.71, 0.78, 0.08);
        context.fillStyle = '#5a4c39';
        context.fillRect(x + 0.18, y + 0.82, 0.13, 0.13);
        context.fillRect(x + 0.69, y + 0.82, 0.13, 0.13);
      }
    }
    context.globalAlpha = 1;
    const glow = context.createRadialGradient(player.x, player.y, 0.3, player.x, player.y, light.range);
    glow.addColorStop(0, '#080d0d00');
    glow.addColorStop(0.56, '#080d0d16');
    glow.addColorStop(1, '#080d0dbb');
    context.fillStyle = glow;
    context.fill(sector);
    context.restore();
  }

  root.DormHorror = { drawStudy };
})(globalThis);
