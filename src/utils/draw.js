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
