(function () {
  var canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;z-index:0;touch-action:none";
  document.body.appendChild(canvas);

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var layers = [];
  var bubbles = [];
  var splashes = [];
  var animFrameId = null;
  var frame = 0;
  var mouse = { x: 0, y: 0, inWater: false, diveTime: 0, lastX: 0, lastY: 0, exitTime: 0 };

  var COLORS = ["#00ff9f", "#00e5ff", "#b967ff", "#ff6ec7"];
  var DRIP_COLOR = "#b967ff";

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initLayers();
  }

  function initLayers() {
    var cols = Math.floor(canvas.width / 15) + 1;
    var base = canvas.height - 120;

    layers = [
      { points: [], baseY: base - 80, fillColor: COLORS[0], strokeColor: COLORS[0], lineWidth: 1.5, tension: 0.008, dampening: 0.06, spread: 0.15, depthFactor: 0.3, waveOffset: 0, waveSpeed: 5e-4, opacity: 0.7 },
      { points: [], baseY: base - 40, fillColor: COLORS[1], strokeColor: COLORS[1], lineWidth: 1.8, tension: 0.01, dampening: 0.055, spread: 0.18, depthFactor: 0.5, waveOffset: Math.PI / 3, waveSpeed: 8e-4, opacity: 0.8 },
      { points: [], baseY: base, fillColor: COLORS[2], strokeColor: COLORS[2], lineWidth: 2, tension: 0.012, dampening: 0.05, spread: 0.2, depthFactor: 0.7, waveOffset: Math.PI / 2, waveSpeed: 0.001, opacity: 0.9 },
      { points: [], baseY: base + 50, fillColor: COLORS[3], strokeColor: COLORS[3], lineWidth: 2.5, tension: 0.015, dampening: 0.045, spread: 0.22, depthFactor: 1, waveOffset: Math.PI, waveSpeed: 0.0012, opacity: 0.65 }
    ];

    layers.forEach(function (layer) {
      layer.points = [];
      for (var i = 0; i < cols; i++) {
        var x = i * canvas.width / (cols - 1);
        layer.points.push({ x: x, y: layer.baseY, velocity: 0, targetY: layer.baseY });
      }
    });
  }

  function updatePhysics(layer) {
    var pts = layer.points;
    for (var i = 0; i < pts.length; i++) {
      var accel = layer.tension * (pts[i].targetY - pts[i].y);
      pts[i].velocity += accel;
      pts[i].y += pts[i].velocity;
      pts[i].velocity *= 1 - layer.dampening;
    }

    var leftDeltas = new Array(pts.length).fill(0);
    var rightDeltas = new Array(pts.length).fill(0);

    for (var iter = 0; iter < 8; iter++) {
      for (var i = 0; i < pts.length; i++) {
        if (i > 0) {
          leftDeltas[i] = layer.spread * (pts[i].y - pts[i - 1].y);
          pts[i - 1].velocity += leftDeltas[i];
        }
        if (i < pts.length - 1) {
          rightDeltas[i] = layer.spread * (pts[i].y - pts[i + 1].y);
          pts[i + 1].velocity += rightDeltas[i];
        }
      }
      for (var i = 0; i < pts.length; i++) {
        if (i > 0) pts[i - 1].y += leftDeltas[i];
        if (i < pts.length - 1) pts[i + 1].y += rightDeltas[i];
      }
    }
  }

  function getSurfaceY(x, layer) {
    var pts = layer.points;
    var idx = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i].x && x <= pts[i + 1].x) { idx = i; break; }
    }
    if (x > pts[pts.length - 1].x) idx = pts.length - 2;

    var a = pts[idx];
    var b = pts[Math.min(idx + 1, pts.length - 1)];
    var t = b.x !== a.x ? (x - a.x) / (b.x - a.x) : 0;
    var y = a.y + (b.y - a.y) * t;
    var amp = 5 * layer.depthFactor;
    var freq = 0.008 / layer.depthFactor;
    var wave = Math.sin(x * freq + frame * layer.waveSpeed + layer.waveOffset) * amp
             + Math.sin(x * freq * 2.3 + frame * layer.waveSpeed * 1.5 + layer.waveOffset) * amp * 0.5;
    return y + wave;
  }

  function drawLayer(layer, isFront) {
    var pts = layer.points;
    ctx.globalAlpha = layer.opacity;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (var k = 0; k < pts.length - 1; k++) {
      var amp = 5 * layer.depthFactor;
      var freq = 0.008 / layer.depthFactor;
      var wave = Math.sin(pts[k].x * freq + frame * layer.waveSpeed + layer.waveOffset) * amp
               + Math.sin(pts[k].x * freq * 2.3 + frame * layer.waveSpeed * 1.5 + layer.waveOffset) * amp * 0.5;
      var mx = (pts[k].x + pts[k + 1].x) / 2;
      var my = (pts[k].y + pts[k + 1].y) / 2 + wave;
      ctx.quadraticCurveTo(pts[k].x, pts[k].y + wave, mx, my);
    }

    var last = pts[pts.length - 1];
    var lastAmp = 5 * layer.depthFactor;
    var lastFreq = 0.008 / layer.depthFactor;
    var lastWave = Math.sin(last.x * lastFreq + frame * layer.waveSpeed + layer.waveOffset) * lastAmp
                 + Math.sin(last.x * lastFreq * 2.3 + frame * layer.waveSpeed * 1.5 + layer.waveOffset) * lastAmp * 0.5;
    ctx.lineTo(last.x, last.y + lastWave);

    if (isFront) {
      ctx.lineTo(canvas.width, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.closePath();
      ctx.fillStyle = layer.fillColor;
      ctx.fill();
    } else {
      ctx.lineTo(canvas.width, last.y + lastWave);
      ctx.lineTo(canvas.width, canvas.height);
      ctx.lineTo(0, canvas.height);
      ctx.lineTo(0, pts[0].y);
      ctx.closePath();
      ctx.fillStyle = layer.fillColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 0; k < pts.length - 1; k++) {
        var amp = 5 * layer.depthFactor;
        var freq = 0.008 / layer.depthFactor;
        var wave = Math.sin(pts[k].x * freq + frame * layer.waveSpeed + layer.waveOffset) * amp
                 + Math.sin(pts[k].x * freq * 2.3 + frame * layer.waveSpeed * 1.5 + layer.waveOffset) * amp * 0.5;
        var mx = (pts[k].x + pts[k + 1].x) / 2;
        var my = (pts[k].y + pts[k + 1].y) / 2 + wave;
        ctx.quadraticCurveTo(pts[k].x, pts[k].y + wave, mx, my);
      }
      ctx.lineTo(last.x, last.y + lastWave);
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.lineWidth;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function spawnBubble(x, y, multi) {
    var count = multi ? Math.floor(Math.random() * 3) + 2 : 1;
    for (var i = 0; i < count; i++) {
      bubbles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.5,
        radius: 2 + Math.random() * 4,
        opacity: 0.6 + Math.random() * 0.3,
        wobbleOffset: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.02,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      });
    }
  }

  function updateBubbles(getSurface) {
    bubbles = bubbles.filter(function (b) {
      b.wobbleOffset += b.wobbleSpeed;
      var wobble = Math.sin(b.wobbleOffset) * 0.3;
      b.vx += wobble * 0.1;

      var dx = mouse.x - b.x;
      var dy = mouse.y - b.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80 && dist > 0) {
        var force = (80 - dist) / 80 * 0.15;
        b.vx -= dx / dist * force;
        b.vy -= dy / dist * force * 0.5;
      }

      b.vy -= 0.02;
      b.vx *= 0.98;
      b.vy *= 0.99;
      b.x += b.vx;
      b.y += b.vy;

      var surfY = getSurface(b.x);
      if (b.y < surfY) {
        b.vy *= 0.3;
        b.y = surfY + Math.random() * 2;
        b.opacity -= 0.03;
        b.radius *= 1.01;
      }
      return b.opacity > 0;
    });
  }

  function drawBubbles() {
    bubbles.forEach(function (b) {
      ctx.globalAlpha = b.opacity;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.globalAlpha = b.opacity * 0.5;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function spawnSplash(x, y, speed) {
    var mid = layers[2];
    var count = Math.min(Math.floor(speed * 2) + 2, 8);
    for (var i = 0; i < count; i++) {
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.6;
      var v = speed * (0.3 + Math.random() * 0.4);
      splashes.push({
        x: x + (Math.random() - 0.5) * 15,
        y: y,
        vx: Math.cos(angle) * v * 1.5,
        vy: Math.sin(angle) * v * 3 - 1,
        length: Math.min(speed * 3, 12) + Math.random() * 3,
        thickness: Math.max(1.5, 3 - speed * 0.2),
        opacity: 0.7 + Math.random() * 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      });
    }
  }

  function updateSplashes() {
    var mid = layers[1];
    splashes = splashes.filter(function (s) {
      s.vy += 0.3;
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.99;
      var surfY = getSurfaceY(s.x, mid);
      if (s.y > surfY) return false;
      s.opacity -= 0.008;
      return s.opacity > 0 && s.y < canvas.height;
    });
  }

  function drawSplashes() {
    splashes.forEach(function (s) {
      ctx.globalAlpha = s.opacity;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.thickness;
      ctx.lineCap = "round";
      var speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      var angle = Math.atan2(s.vy, s.vx);
      var len = s.length * Math.min(speed / 5, 2);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - Math.cos(angle) * len, s.y - Math.sin(angle) * len);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function handleMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var midUpper = layers[1];
    var midLower = layers[2];
    var threshold = midUpper.baseY - 20;
    var wasInWater = mouse.inWater;
    var isInWater = my >= threshold;

    mouse.lastX = mouse.x;
    mouse.lastY = mouse.y;
    mouse.x = mx;
    mouse.y = my;
    mouse.inWater = isInWater;

    if (isInWater && !wasInWater) {
      mouse.diveTime = 0;
      for (var i = 0; i < 5; i++) spawnBubble(mx, my + Math.random() * 20, true);
      var dx = mx - mouse.lastX;
      var dy = my - mouse.lastY;
      var speed = Math.sqrt(dx * dx + dy * dy);
      var surfY = getSurfaceY(mx, midUpper);
      spawnSplash(mx, surfY, Math.min(speed / 5, 4));
    }

    if (!isInWater && wasInWater) {
      mouse.exitTime = 60;
      var dx = mx - mouse.lastX;
      var dy = my - mouse.lastY;
      var speed = Math.sqrt(dx * dx + dy * dy);
      var surfY = getSurfaceY(mx, midUpper);
      spawnSplash(mx, surfY, Math.min(speed / 4, 5));
    }

    if (!isInWater) {
      mouse.diveTime = 0;
      if (mouse.exitTime > 0) {
        mouse.exitTime -= 1;
        if (Math.random() < 0.15) {
          splashes.push({
            x: mx + (Math.random() - 0.5) * 10,
            y: my + Math.random() * 5,
            vx: (Math.random() - 0.5) * 0.5,
            vy: 0.5 + Math.random() * 1,
            length: 3 + Math.random() * 4,
            thickness: 1 + Math.random() * 1.5,
            opacity: 0.4 + Math.random() * 0.3,
            color: DRIP_COLOR
          });
        }
      }
      return;
    }

    for (var li = 1; li <= 2; li++) {
      var layer = layers[li];
      var pts = layer.points;
      var depth = Math.max(0, my - layer.baseY);
      var depthFactor = Math.max(0, 1 - depth / 200);
      var depthSq = depthFactor * depthFactor;

      for (var i = 0; i < pts.length; i++) {
        var dist = Math.abs(pts[i].x - mx);
        if (dist < 150) {
          var force = (150 - dist) / 150 * (my - pts[i].y) * 0.025 * (0.1 + depthSq * 0.9);
          pts[i].velocity += force;
        }
      }
    }
  }

  function handleClick(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    if (my < layers[1].baseY - 20) return;

    for (var li = 1; li <= 2; li++) {
      var pts = layers[li].points;
      for (var i = 0; i < pts.length; i++) {
        var dist = Math.abs(pts[i].x - mx);
        if (dist < 200) {
          var force = 200 - dist;
          pts[i].velocity -= force / 200 * 10;
        }
      }
    }
  }

  function handleMouseLeave() {
    mouse.inWater = false;
    mouse.diveTime = 0;
  }

  function handleTouchStart(e) {
    e.preventDefault();
    var touch = e.touches[0];
    if (!touch) return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = touch.clientX - rect.left;
    mouse.y = touch.clientY - rect.top;
    mouse.lastX = mouse.x;
    mouse.lastY = mouse.y;
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
  }

  function handleTouchMove(e) {
    e.preventDefault();
    var touch = e.touches[0];
    if (!touch) return;
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
  }

  function animate() {
    frame += 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var midUpper = layers[1];
    var midLower = layers[2];

    var outerPairs = [
      { source: midUpper, target: layers[0], strength: 0.45 },
      { source: midLower, target: layers[3], strength: 0.45 }
    ];
    outerPairs.forEach(function (pair) {
      var src = pair.source;
      var tgt = pair.target;
      for (var n = 0; n < tgt.points.length && n < src.points.length; n++) {
        var srcDisp = src.points[n].y - src.baseY;
        var tgtDisp = tgt.points[n].y - tgt.baseY;
        var diff = srcDisp - tgtDisp;
        tgt.points[n].velocity += diff * pair.strength * 0.02;
      }
    });

    var crossCoupling = 0.15;
    for (var n = 0; n < midUpper.points.length && n < midLower.points.length; n++) {
      var upperDisp = midUpper.points[n].y - midUpper.baseY;
      var lowerDisp = midLower.points[n].y - midLower.baseY;
      var diff = upperDisp - lowerDisp;
      midLower.points[n].velocity += diff * crossCoupling * 0.02;
      midUpper.points[n].velocity -= diff * crossCoupling * 0.01;
    }

    layers.forEach(function (layer) { updatePhysics(layer); });

    for (var i = 0; i < layers.length - 1; i++) {
      drawLayer(layers[i], false);
    }

    updateBubbles(function (x) { return getSurfaceY(x, midLower); });
    drawBubbles();

    drawLayer(layers[layers.length - 1], true);

    updateSplashes();
    drawSplashes();

    if (mouse.inWater) {
      mouse.diveTime += 1;
      var bubbleRate = mouse.diveTime < 60 ? 0.4 : mouse.diveTime < 180 ? 0.15 : 0.02;
      var multiBubble = mouse.diveTime < 60;
      if (Math.random() < bubbleRate) spawnBubble(mouse.x, mouse.y, multiBubble);
    }

    animFrameId = requestAnimationFrame(animate);
  }

  function randomPoke() {
    var layer = layers[Math.floor(Math.random() * layers.length)];
    var idx = Math.floor(Math.random() * layer.points.length);
    layer.points[idx].velocity += (Math.random() - 0.5) * 6 * layer.depthFactor;
    var delay = 2000 + Math.random() * 3000;
    setTimeout(randomPoke, delay);
  }

  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("click", handleClick);
  canvas.addEventListener("mouseleave", handleMouseLeave);
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleMouseLeave);

  window.addEventListener("resize", resize);
  resize();
  setTimeout(randomPoke, 1000);
  animate();
})();
