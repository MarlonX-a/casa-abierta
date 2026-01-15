export function drawHands(hands, canvasWidth, canvasHeight, ctx) {
  if (!hands || hands.length <= 0) return;

  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i];
    ctx.fillStyle = hand.handedness === "Left" ? "#3b82f6" : "#10b981";
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;

    for (let key in hand.keypoints) {
      const kp = hand.keypoints[key];
      // Las coordenadas ya están normalizadas (0-1)
      // El canvas tiene scaleX(-1), así que NO invertimos aquí
      const x = kp.x * canvasWidth;
      const y = kp.y * canvasHeight;

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }
}

export function drawPath(points) {
  const lastPoint = points[points.length - 1];
  const editor = window["editor"];
  const point = getClientPointFromCanvasPoint({ point: lastPoint, editor });

  editor.dispatch({
    type: "pointer",
    target: "canvas",
    name: "pointer_move",
    // weird but true: we need to put the screen point back into client space
    point,
    pointerId: 0,
    ctrlKey: editor.inputs.ctrlKey,
    altKey: editor.inputs.altKey,
    shiftKey: editor.inputs.shiftKey,
    button: 0,
    isPen: false,
  });
}

export function getClientPointFromCanvasPoint({ point, editor }) {
  // Las coordenadas de MediaPipe están normalizadas (0-1)
  // El canvas está en espejo (scaleX(-1)), así que invertimos X
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  return {
    x: (1 - point.x) * screenWidth,  // Invertir X por el espejo
    y: point.y * screenHeight,
  };
}

// Convierte punto normalizado (0..1) a coordenadas de canvas (px)
export function screenFromNormalized(point, canvasWidth, canvasHeight) {
  return {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
  };
}

export function drawHalo(ctx, x, y, { baseRadius = 36, color = "#3b82f6", progress = 1, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  // easing (easeOutQuad)
  const p = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 2);
  const radius = baseRadius * (0.6 + 0.9 * p);

  // outer ring
  ctx.lineWidth = Math.max(2, 8 * (1 - p) + 1);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  // subtle inner glow (solid circle with low alpha)
  ctx.fillStyle = color;
  ctx.globalAlpha = Math.max(0.06, 0.18 * p) * alpha;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(4, radius * 0.25), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawLabel(ctx, x, y, { text = "", confidence = null, font = "600 14px Inter, Arial", color = "#fff", bg = "rgba(0,0,0,0.5)" } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;

  const confText = confidence != null ? ` ${Math.round(confidence * 100)}%` : "";
  const full = text + confText;
  const paddingX = 8;
  const paddingY = 6;
  const metrics = ctx.measureText(full);
  const w = metrics.width + paddingX * 2;
  const h = 20 + paddingY;

  // rounded rect background
  ctx.fillStyle = bg;
  const rx = 8;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + rx, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + rx, rx);
  ctx.arcTo(x + w / 2, y + h / 2, x + w / 2 - rx, y + h / 2, rx);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - rx, rx);
  ctx.arcTo(x - w / 2, y - h / 2, x - w / 2 + rx, y - h / 2, rx);
  ctx.closePath();
  ctx.fill();

  // text
  ctx.fillStyle = color;
  ctx.fillText(full, x - metrics.width / 2, y);
  ctx.restore();
}

// Dibuja un efecto tipo "láser" temporal sobre una lista de puntos normalizados
export function drawLaser(points, canvasWidth, canvasHeight, ctx, { color = "#00e5ff" } = {}) {
  if (!points || points.length < 2) return;

  // convertir puntos normalizados a pixeles
  const pts = points.map((p) => ({ x: p.x * canvasWidth, y: p.y * canvasHeight }));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // capa exterior (glow)
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = color;
  ctx.lineWidth = 22;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // capa intermedia
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // núcleo brillante
  ctx.lineWidth = 3;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  ctx.restore();
}
