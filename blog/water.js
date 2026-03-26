(function () {
  var canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none";
  document.body.appendChild(canvas);

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var layers = [];
  var bubbles = [];
  var splashes = [];
  var animFrameId = null;
  var frame = 0;
  var mouse = { x: 0, y: 0, inWater: false, diveTime: 0, lastX: 0, lastY: 0, exitTime: 0 };
  var diveDepth = 0;
  var LAYER_OFFSETS = [160, 115, 75, 40];

  var COLORS = ["#00ff9f", "#00e5ff", "#b967ff", "#ff6ec7"];
  var DRIP_COLOR = "#b967ff";

  var fishes = [];
  var FISH_DEFS = [
    { threshold: 0.40, yFrac: 0.5, speed: 0.35, size: 3, startDir: 1 },
    { threshold: 0.50, yFrac: 0.7, speed: 0.5,  size: 2.5, startDir: -1 },
    { threshold: 0.60, yFrac: 0.4, speed: 0.3,  size: 3.5, startDir: 1 },
    { threshold: 0.70, yFrac: 0.8, speed: 0.45, size: 2, startDir: -1 },
    { threshold: 0.78, yFrac: 0.6, speed: 0.55, size: 2.8, startDir: 1 }
  ];
  function makeFish(def) {
    return {
      x: def.startDir === 1 ? -50 : canvas.width + 50,
      y: canvas.height * def.yFrac,
      dir: def.startDir, speed: def.speed, size: def.size,
      yFrac: def.yFrac, bobOffset: Math.random() * Math.PI * 2,
      fishBubbles: [],
      fleeing: false, fleeTimer: 0, fleeVx: 0, fleeVy: 0, circleAngle: 0,
      spawned: false
    };
  }
  var spikes = [];
  var deepSpikes = [];

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

    initSpikes();
    fishes = [];
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

  function initSpikes() {
    spikes = [];
    deepSpikes = [];
    for (var i = 0; i < 60; i++) {
      var x = Math.random() * canvas.width;
      var h = 40 + Math.random() * 220;
      var angle = (Math.random() - 0.5) * 1.2;
      var w = 6 + Math.random() * 35;
      var palette = [
        "#000", "#000", "#000",
        "#1a002a", "#2d004a", "#0a0020",
        "#ff006e", "#b967ff", "#00ff9f",
        "#ff0044", "#6600aa"
      ];
      var color = palette[Math.floor(Math.random() * palette.length)];
      var glow = Math.random() > 0.7;
      deepSpikes.push({
        x: x, w: w, h: h, angle: angle,
        jitter: Math.random() * Math.PI * 2,
        speed: 0.005 + Math.random() * 0.02,
        color: color, glow: glow,
        segments: Math.floor(2 + Math.random() * 4),
        twist: (Math.random() - 0.5) * 0.3,
        depth: 0.3 + Math.random() * 0.7
      });
    }
    deepSpikes.sort(function (a, b) { return a.depth - b.depth; });
  }

  function drawFish(px, py, dir, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.scale(dir, 1);
    var s = size;

    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(-s * 3, -s, s * 6, s * 2);
    ctx.fillRect(-s * 4, 0, s, s);
    ctx.fillRect(s * 3, -s * 2, s, s);
    ctx.fillRect(s * 3, s, s, s);

    ctx.fillStyle = "#b967ff";
    ctx.fillRect(-s * 5, -s, s, s * 2);
    ctx.fillRect(-s * 6, -s * 2, s, s * 3);
    ctx.fillRect(-s * 6, s, s, s);

    ctx.fillStyle = "#ff6ec7";
    ctx.fillRect(s, -s * 2, s * 2, s);
    ctx.fillRect(0, s, s * 2, s);

    ctx.fillStyle = "#000";
    ctx.fillRect(s * 2, -s, s, s);

    ctx.fillStyle = "#fff";
    ctx.fillRect(s * 2.3, -s * 0.7, s * 0.4, s * 0.4);

    ctx.restore();
  }

  function updateOneFish(f) {
    var pinkLayer = layers[layers.length - 1];
    var pinkY = pinkLayer ? pinkLayer.baseY + 40 : canvas.height * 0.7;
    var range = canvas.height - pinkY;
    var baseY = pinkY + range * f.yFrac;
    var parallaxShift = diveDepth * range * 0.15;
    var restY = Math.max(baseY - parallaxShift, pinkY);
    f.bobOffset += 0.015;
    var bobY = Math.sin(f.bobOffset) * 8;

    var dx = mouse.x - f.x;
    var dy = mouse.y - (restY + bobY);
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (!f.fleeing && dist < 100 && mouse.x > 0) {
      f.fleeing = true;
      f.fleeTimer = 90;
      f.circleAngle = Math.atan2(dy, dx);
      var fleeSpeed = 4;
      f.fleeVx = -Math.cos(f.circleAngle) * fleeSpeed;
      f.fleeVy = -Math.sin(f.circleAngle) * fleeSpeed;
      f.dir = f.fleeVx > 0 ? 1 : -1;
    }

    if (f.fleeing) {
      f.fleeTimer--;
      f.circleAngle += 0.06;
      f.fleeVx += Math.cos(f.circleAngle) * 0.3;
      f.fleeVy += Math.sin(f.circleAngle) * 0.2;
      f.fleeVx *= 0.96;
      f.fleeVy *= 0.96;
      f.x += f.fleeVx;
      f.y += f.fleeVy;
      f.dir = f.fleeVx > 0 ? 1 : -1;

      var fleeMinY = layers[layers.length - 1] ? layers[layers.length - 1].baseY + 40 : canvas.height * 0.7;
      if (f.y < fleeMinY) { f.y = fleeMinY; f.fleeVy = Math.abs(f.fleeVy) * 0.5; }
      if (f.fleeTimer <= 0) f.fleeing = false;

      if (Math.random() < 0.15) {
        f.fishBubbles.push({
          x: f.x - f.dir * 20, y: f.y - 2,
          vy: -0.5 - Math.random() * 0.6, vx: (Math.random() - 0.5) * 0.5,
          radius: 1 + Math.random() * 3, opacity: 0.6 + Math.random() * 0.3,
          wobble: Math.random() * Math.PI * 2
        });
      }
    } else {
      f.x += f.speed * f.dir;
      f.y += (restY + bobY - f.y) * 0.05;

      if (f.dir === 1 && f.x > canvas.width + 50) {
        f.dir = -1;
      } else if (f.dir === -1 && f.x < -50) {
        f.dir = 1;
      }

      if (Math.random() < 0.03) {
        f.fishBubbles.push({
          x: f.x - f.dir * 20, y: f.y - 2,
          vy: -0.3 - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.2,
          radius: 1.5 + Math.random() * 2.5, opacity: 0.5 + Math.random() * 0.3,
          wobble: Math.random() * Math.PI * 2
        });
      }
    }

    f.fishBubbles = f.fishBubbles.filter(function (b) {
      b.wobble += 0.03;
      b.x += b.vx + Math.sin(b.wobble) * 0.15;
      b.y += b.vy;
      b.opacity -= 0.005;
      return b.opacity > 0;
    });
  }

  function drawFishBubbles(f, alpha) {
    f.fishBubbles.forEach(function (b) {
      ctx.globalAlpha = b.opacity * alpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function drawDeepSpikes(scrollInY, alpha) {
    if (deepSpikes.length === 0) return;
    ctx.save();

    for (var i = 0; i < deepSpikes.length; i++) {
      var sp = deepSpikes[i];
      var baseY = canvas.height + scrollInY;
      var jitter = Math.sin(frame * sp.speed + sp.jitter);
      var breathe = 1 + Math.sin(frame * sp.speed * 0.7 + sp.jitter) * 0.08;

      ctx.save();
      ctx.globalAlpha = alpha * sp.depth;
      ctx.translate(sp.x, baseY);
      ctx.rotate(sp.angle + jitter * 0.05);
      ctx.scale(breathe, breathe);

      var h = sp.h * sp.depth;
      var w = sp.w * sp.depth;

      if (sp.glow) {
        ctx.shadowColor = sp.color;
        ctx.shadowBlur = 15 + jitter * 5;
      }

      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      var segs = sp.segments;
      for (var s = 1; s <= segs; s++) {
        var frac = s / segs;
        var twist = Math.sin(frac * Math.PI + frame * sp.speed) * sp.twist * w;
        var segW = (w / 2) * (1 - frac * 0.85);
        if (s < segs) {
          ctx.lineTo(twist - segW, -h * frac);
          ctx.lineTo(twist + segW, -h * frac);
        } else {
          ctx.lineTo(twist, -h);
        }
      }
      for (var s = segs - 1; s >= 1; s--) {
        var frac = s / segs;
        var twist = Math.sin(frac * Math.PI + frame * sp.speed) * sp.twist * w;
        var segW = (w / 2) * (1 - frac * 0.85);
        ctx.lineTo(twist + segW + 1, -h * frac);
      }
      ctx.lineTo(w / 2, 0);
      ctx.closePath();

      ctx.fillStyle = sp.color;
      ctx.fill();

      if (sp.depth > 0.6 && sp.color !== "#000") {
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha * 0.3;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.restore();
    }

    ctx.restore();
  }

  function handleMouseMove(e) {
    var mx = e.clientX || 0;
    var my = e.clientY || 0;
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
    var mx = e.clientX || 0;
    var my = e.clientY || 0;
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
    var touch = e.touches[0];
    if (!touch) return;
    mouse.x = touch.clientX;
    mouse.y = touch.clientY;
    mouse.lastX = mouse.x;
    mouse.lastY = mouse.y;
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
  }

  function handleTouchMove(e) {
    var touch = e.touches[0];
    if (!touch) return;
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: canvas });
  }

  function animate() {
    frame += 1;

    var scrollY = window.pageYOffset || 0;
    var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    diveDepth = maxScroll > 0 ? scrollY / maxScroll : 0;

    var shift = diveDepth * canvas.height * 1.4;
    var base = canvas.height - 120;
    for (var i = 0; i < layers.length; i++) {
      var newBaseY = base - LAYER_OFFSETS[i] + 120 - shift;
      layers[i].baseY = newBaseY;
      for (var j = 0; j < layers[i].points.length; j++) {
        layers[i].points[j].targetY = newBaseY;
      }
    }

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

    for (var fi = 0; fi < FISH_DEFS.length; fi++) {
      var def = FISH_DEFS[fi];
      if (diveDepth > def.threshold) {
        if (!fishes[fi]) fishes[fi] = makeFish(def);
        var f = fishes[fi];
        updateOneFish(f);
        var alpha = Math.min((diveDepth - def.threshold) * 4, 1);
        drawFishBubbles(f, alpha);
        drawFish(f.x, f.y, f.dir, f.size, alpha);
      }
    }

    var spikeThreshold = 0.85;
    if (diveDepth > spikeThreshold) {
      var spikeProg = (diveDepth - spikeThreshold) / (1 - spikeThreshold);
      var spikeAlpha = Math.min(spikeProg * 2, 1);
      var scrollInY = (1 - spikeProg) * 300;
      drawDeepSpikes(scrollInY, spikeAlpha);
    }

    if (diveDepth > 0) {
      var darkness = Math.min(diveDepth * 1.8, 0.8);
      var darkTop = layers[0].baseY;
      if (darkTop < canvas.height) {
        var grad = ctx.createLinearGradient(0, darkTop, 0, canvas.height);
        grad.addColorStop(0, "rgba(5, 0, 20, 0)");
        grad.addColorStop(0.15, "rgba(5, 0, 20, " + (darkness * 0.3) + ")");
        grad.addColorStop(1, "rgba(5, 0, 20, " + darkness + ")");
        ctx.fillStyle = grad;
        ctx.fillRect(0, darkTop, canvas.width, canvas.height - darkTop);
      }
    }

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

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("click", handleClick);
  document.addEventListener("mouseleave", handleMouseLeave);
  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchmove", handleTouchMove, { passive: true });
  document.addEventListener("touchend", handleMouseLeave);

  window.addEventListener("resize", resize);
  resize();
  setTimeout(randomPoke, 1000);
  animate();
})();
