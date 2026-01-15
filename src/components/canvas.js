import { useEffect, useState, useRef } from "react";
import { DefaultSizeStyle, Tldraw, getSvgPathFromPoints } from "tldraw";

import FloatingMenu from "./menu";

import { createKeyMap, getUserHandGesture } from "../utils/pose";
import { useAnimationFrame } from "../hooks/animation";
import { setupWebcam, teardownWebcam } from "../utils/video";
import { euclideanDistance } from "../utils/transforms";
import {
  drawHands,
  drawPath,
  getClientPointFromCanvasPoint,
} from "../utils/draw";
import { screenFromNormalized, drawHalo, drawLabel, drawLaser } from "../utils/draw";

/* =========================
  CONFIG PERFORMANCE
========================= */
const TARGET_FPS = 60;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

/* =========================
   SCRIBBLE
========================= */
function LaserScribble({ scribble, zoom, opacity }) {
  if (!scribble.points.length) return null;

  return (
    <svg className="tl-overlays__item">
      <path
        d={getSvgPathFromPoints(scribble.points, false)}
        stroke="rgba(255, 0, 0, 0.5)"
        fill="none"
        strokeWidth={8 / zoom}
        opacity={opacity ?? scribble.opacity}
      />
    </svg>
  );
}

/* =========================
   CANVAS SETUP (FULLSCREEN)
========================= */
async function setupCanvas(_video, canvasID) {
  const canvas = document.getElementById(canvasID);
  const ctx = canvas.getContext("2d");

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  return [canvas, ctx];
}

export default function CanvasComponent({ detector, isModelLoaded }) {
  const editor = window.editor;

  const videoRef = useRef(null);
  const floatingCanvasCtxRef = useRef(null);

  const [fps, setFps] = useState(0);
  const fpsCounterRef = useRef(0);
  const fpsLastUpdateRef = useRef(performance.now());
  const detectIntervalRef = useRef(FRAME_INTERVAL);
  const lowPerfRef = useRef(false);

  const fpsClass = (() => {
    if (fps >= 50) return "fps-good";
    if (fps >= 30) return "fps-warn";
    return "fps-bad";
  })();

  const [isStreaming, setStreaming] = useState(false);
  const [isDrawing, setDrawing] = useState(false);

  const drawingPointsRef = useRef([]);
  const lastVideoTimeRef = useRef(-1);
  const lastProcessTimeRef = useRef(0);
  const previousGestureRef = useRef(null);
  const overlayStateRef = useRef(new Map());

  const gestureColorMap = {
    index_pinch: "#10b981", // green -> draw
    middle_pinch: "#f97316", // orange -> tool
    default: "#3b82f6",
  };

  const particlesRef = useRef([]);
  let MAX_PARTICLES = 300;

  const clearBtnRef = useRef(null);
  const clearHoverRef = useRef({ start: 0 });
  const lastClearRef = useRef(0);
  const [editorKey, setEditorKey] = useState(0);
  const btnRectRef = useRef(null);

  // Cache del rect del botón para evitar lecturas DOM cada frame (evita ResizeObserver loop warnings)
  useEffect(() => {
    function updateBtnRect() {
      try {
        // try to find button by ref first, else by id
        let btn = clearBtnRef.current;
        if (!btn) btn = document.getElementById("clear-btn");
        if (btn) {
          clearBtnRef.current = btn;
          btnRectRef.current = btn.getBoundingClientRect();
        }
      } catch (e) {
        btnRectRef.current = null;
      }
    }

    updateBtnRect();
    window.addEventListener("resize", updateBtnRect);
    return () => window.removeEventListener("resize", updateBtnRect);
  }, []);

  // Observe mutations to refresh rect if DOM structure changes
  useEffect(() => {
    const obs = new MutationObserver(() => {
      try {
        const btn = clearBtnRef.current;
        if (btn) btnRectRef.current = btn.getBoundingClientRect();
      } catch (e) {
        btnRectRef.current = null;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const emitParticles = (normPoint, color, count = 12) => {
    const ctx = floatingCanvasCtxRef.current;
    if (!ctx) return;
    if (lowPerfRef.current) return; // don't emit when in low-performance mode
    const now = performance.now();
    const canvasW = ctx.canvas.width;
    const canvasH = ctx.canvas.height;

    for (let i = 0; i < count; i++) {
      if (particlesRef.current.length >= MAX_PARTICLES) break;

      const x = normPoint.x * canvasW;
      const y = normPoint.y * canvasH;

      // random velocity px per ms
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.03 + Math.random() * 0.18; // px per ms
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - (Math.random() * 0.02);

      const size = 2 + Math.random() * 4;
      const life = 500 + Math.random() * 700; // ms

      particlesRef.current.push({
        x,
        y,
        vx,
        vy,
        size,
        birth: now,
        lastTs: now,
        life,
        color,
      });
    }
  };

  const availableTools = ["select", "hand", "draw", "eraser", "geo"];

  const changeCanvasTool = (gesture) => {
    if (gesture === previousGestureRef.current) return;
    previousGestureRef.current = gesture;

    if (gesture === "middle_pinch") {
      const currentTool = editor.getCurrentTool();
      const currentToolIndex = availableTools.indexOf(currentTool.id);
      const nextToolIndex =
        currentToolIndex !== -1
          ? (currentToolIndex + 1) % availableTools.length
          : 0;

      editor.setCurrentTool(availableTools[nextToolIndex]);
    }
  };

  const nextDrawingPointIsFarEnough = (trackingPoint, previousPoint) => {
    // reducir umbral para permitir movimientos finos y mejorar precisión
    return (
      euclideanDistance([
        [trackingPoint.x, previousPoint.x],
        [trackingPoint.y, previousPoint.y],
      ]) >= 0.0005
    );
  };

  const draw = (hands) => {
    if (!hands || hands.length < 1 || !editor) {
      setDrawing(false);
      return;
    }

    for (let i = 0; i < hands.length; i++) {
      const [gesture, trackingPoint] = getUserHandGesture(hands[i]);
      changeCanvasTool(gesture);

      // actualizar overlay state para este indice de mano
      try {
        const now = performance.now();
        const key = i; // usar índice como key estable en el frame
        const prev = overlayStateRef.current.get(key);

        if (gesture && trackingPoint) {
          if (!prev || prev.gesture !== gesture) {
            const state = {
              gesture,
              point: trackingPoint,
              startTs: now,
              lastSeen: now,
              duration: 360,
              color: gestureColorMap[gesture] || gestureColorMap.default,
              label: gesture,
            };
            overlayStateRef.current.set(key, state);
            // emitir partículas cuando aparece un nuevo gesto
            try {
              emitParticles(trackingPoint, state.color, 16);
            } catch (e) {}
          } else {
            // actualizar posición + tiempo visto
            prev.point = trackingPoint;
            prev.lastSeen = now;
          }
        } else if (prev) {
          // marcar última vez visto (se mantendrá un breve tiempo para linger)
          prev.lastSeen = now;
        }
      } catch (e) {
        // no bloquear la lógica principal por overlays
      }

      if (gesture === "index_pinch" && trackingPoint) {
        if (drawingPointsRef.current.length > 0) {
          const previousPoint =
            drawingPointsRef.current[drawingPointsRef.current.length - 1];
          if (!nextDrawingPointIsFarEnough(trackingPoint, previousPoint)) continue;
        }

        drawingPointsRef.current.push(trackingPoint);
        setDrawing(true);

        if (editor && !editor.inputs.buttons.has(0)) {
          const point = getClientPointFromCanvasPoint({
            point: trackingPoint,
            editor,
          });

          editor.dispatch({
            type: "pointer",
            target: "canvas",
            name: "pointer_down",
            point,
            pointerId: 0,
            button: 0,
            isPen: false,
          });
        }

        drawPath(drawingPointsRef.current);
      } else {
        setDrawing(false);
      }
    }
  };

  /* =========================
     WEBCAM INIT / DESTROY
========================= */
  useEffect(() => {
    async function init() {
      if (!videoRef.current) {
          videoRef.current = await setupWebcam({
            width: 640,
            height: 480,
            frameRate: 60,
          });
        }

      if (!floatingCanvasCtxRef.current) {
        const [, ctx] = await setupCanvas(videoRef.current, "float-canvas");
        floatingCanvasCtxRef.current = ctx;
      }
    }

    async function destroy() {
      if (videoRef.current) {
        await teardownWebcam(videoRef.current);
        videoRef.current = null;
      }

      if (floatingCanvasCtxRef.current) {
        floatingCanvasCtxRef.current.clearRect(
          0,
          0,
          floatingCanvasCtxRef.current.canvas.width,
          floatingCanvasCtxRef.current.canvas.height
        );
        floatingCanvasCtxRef.current = null;
      }
    }

    isStreaming ? init() : destroy();
  }, [isStreaming]);

  /* =========================
     POINTER UP CLEANUP
========================= */
  useEffect(() => {
    if (!isDrawing && drawingPointsRef.current.length > 0) {
      const lastPoint =
        drawingPointsRef.current[drawingPointsRef.current.length - 1];

      const point = getClientPointFromCanvasPoint({
        point: lastPoint,
        editor,
      });

      editor.dispatch({
        type: "pointer",
        target: "canvas",
        name: "pointer_up",
        point,
        pointerId: 0,
        button: 0,
        isPen: false,
      });

      drawingPointsRef.current = [];
    }
  }, [isDrawing, editor]);

  /* =========================
     MAIN LOOP (60 FPS optimizado)
========================= */
  useAnimationFrame(() => {
    if (!detector || !videoRef.current || !floatingCanvasCtxRef.current) return;
    if (videoRef.current.readyState < 2) return;

    const now = performance.now();
    if (now - lastProcessTimeRef.current < detectIntervalRef.current) return;
    
    // Solo procesar si hay un nuevo frame de video
    if (videoRef.current.currentTime === lastVideoTimeRef.current) return;
    
    lastProcessTimeRef.current = now;
    lastVideoTimeRef.current = videoRef.current.currentTime;

    // Contador de FPS (frames procesados por segundo) — actualiza cada 250ms
    fpsCounterRef.current += 1;
    const fpsNow = performance.now();
    if (fpsNow - fpsLastUpdateRef.current >= 250) {
      const measured = Math.round((fpsCounterRef.current * 1000) / (fpsNow - fpsLastUpdateRef.current));
      setFps(measured);
      fpsCounterRef.current = 0;
      fpsLastUpdateRef.current = fpsNow;
      // adaptative fallback: if measured FPS drops, increase detection interval and reduce effects
      if (measured < 36) {
        lowPerfRef.current = true;
        detectIntervalRef.current = 1000 / 30; // fallback to 30 fps inference
        MAX_PARTICLES = 80;
      } else {
        lowPerfRef.current = false;
        detectIntervalRef.current = 1000 / TARGET_FPS;
        MAX_PARTICLES = 300;
      }
    }

    let hands;
    try {
      hands = detector.recognizeForVideo(videoRef.current, now);
      hands = createKeyMap(hands);
    } catch (e) {
      return;
    }

    const ctx = floatingCanvasCtxRef.current;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    draw(hands);

    if (hands && hands.length > 0) {
      drawHands(hands, ctx.canvas.width, ctx.canvas.height, ctx);
    }

    // Si estamos dibujando (puntos activos) dibujar efecto láser encima
    try {
      const pts = drawingPointsRef.current;
      if (!lowPerfRef.current && pts && pts.length > 1) {
        drawLaser(pts, ctx.canvas.width, ctx.canvas.height, ctx, { color: "#00f6ff" });
      }
    } catch (e) {}

    // Dibujar overlays de gestos encima de todo
    try {
      const now = performance.now();
      const canvasW = ctx.canvas.width;
      const canvasH = ctx.canvas.height;
      const entries = Array.from(overlayStateRef.current.entries());
      for (let [key, state] of entries) {
        // expirar si hace mucho que no se ve (p. ej. 900ms)
        if (now - (state.lastSeen || 0) > 900) {
          overlayStateRef.current.delete(key);
          continue;
        }

        const elapsed = now - (state.startTs || 0);
        const progress = Math.max(0, Math.min(1, elapsed / (state.duration || 300)));
        const eased = 1 - Math.pow(1 - progress, 2);

        const p = state.point;
        if (!p) continue;
        const { x, y } = screenFromNormalized(p, canvasW, canvasH);

        drawHalo(ctx, x, y, { baseRadius: 44, color: state.color, progress: eased, alpha: 1 });
        drawLabel(ctx, x, y - 56, { text: state.label, confidence: null, bg: "rgba(0,0,0,0.45)" });
      }
    } catch (e) {
      // ignore overlay drawing errors
    }

    // Partículas AR
    try {
      if (lowPerfRef.current) {
        particlesRef.current = [];
      } else {
        const nowP = performance.now();
        const particles = particlesRef.current;
        // update & draw
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          const dt = Math.max(0, nowP - (p.lastTs || p.birth));
          p.lastTs = nowP;
          p.x += p.vx * dt;
          p.y += p.vy * dt + 0.0005 * dt; // slight gravity

          const age = nowP - p.birth;
          const lifeRatio = Math.max(0, Math.min(1, age / p.life));
          const alpha = 1 - lifeRatio;

          if (age >= p.life) {
            particles.splice(i, 1);
            continue;
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // cap total particles
        if (particles.length > MAX_PARTICLES) {
          particlesRef.current = particles.slice(particles.length - MAX_PARTICLES);
        }
      }
    } catch (e) {
      // ignore particle errors
    }

    // Detección de acercamiento al botón Clear (activar borrado)
    try {
      const btn = clearBtnRef.current;
      const nowC = performance.now();
      if (btn) {
        const rect = btnRectRef.current;
        let anyOver = false;

        // comprobar cada mano si tiene punto de tracking y está sobre el botón
        if (hands && hands.length > 0) {
          for (let i = 0; i < hands.length; i++) {
            const [gesture, trackingPoint] = getUserHandGesture(hands[i]);
            if (!trackingPoint) continue;

            const client = getClientPointFromCanvasPoint({ point: trackingPoint, editor });
            const cx = client.x;
            const cy = client.y;

            // permitir margen de 36 px alrededor
            const margin = 36;
            if (
              cx >= rect.left - margin &&
              cx <= rect.right + margin &&
              cy >= rect.top - margin &&
              cy <= rect.bottom + margin
            ) {
              anyOver = true;
              // iniciar hover timer
              if (!clearHoverRef.current.start) clearHoverRef.current.start = nowC;
              const elapsed = nowC - clearHoverRef.current.start;
              const pct = Math.min(100, Math.round((elapsed / 600) * 100));
              btn.style.setProperty("--clear-progress", `${pct}%`);
              if (elapsed >= 600 && nowC - lastClearRef.current > 1200) {
                // activar borrado: remontar editor para limpiar
                setEditorKey((k) => k + 1);
                lastClearRef.current = nowC;
                clearHoverRef.current.start = 0;
                btn.classList.add("cleared-flash");
                setTimeout(() => btn.classList.remove("cleared-flash"), 600);
                break;
              }
            }
          }
        }

        if (!anyOver) {
          clearHoverRef.current.start = 0;
          btn.style.setProperty("--clear-progress", `0%`);
        }
      }
    } catch (e) {}
  }, isStreaming && isModelLoaded);

  /* =========================
     RENDER
========================= */
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <FloatingMenu
        isStreaming={isStreaming}
        setStreaming={setStreaming}
        videoRef={videoRef}
        isModelLoaded={isModelLoaded}
      />

      {/* Clear button moved into BrandHeader; obtain ref by id on mount */}

      {/* FPS BADGE */}
      <div className={`fps-badge ${fpsClass}`}>
        <div className="fps-row">
          <div className="fps-value">{fps}</div>
          <div className="fps-label">FPS</div>
        </div>

        <div className="fps-bar">
          <div
            className="fps-fill"
            style={{
              width: `${Math.min(100, Math.round((fps / TARGET_FPS) * 100))}%`,
              background:
                fps >= 50
                  ? "linear-gradient(90deg,#00d084,#7ef7b7)"
                  : fps >= 30
                  ? "linear-gradient(90deg,#ffb020,#ffd27a)"
                  : "linear-gradient(90deg,#ff4b4b,#ff9b9b)",
            }}
          />
        </div>
      </div>

      {/* CANVAS FULLSCREEN */}
      <canvas
        id="float-canvas"
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          transform: "scaleX(-1)",
          background: "transparent",
          zIndex: 100000,
        }}
      />

      {/* VIDEO OCULTO (SOLO INPUT) - Debe tener tamaño real para MediaPipe */}
      <video
        id="video"
        autoPlay
        muted
        playsInline
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "640px",
          height: "480px",
          opacity: 0,
          pointerEvents: "none",
          zIndex: -1,
          visibility: "hidden",
        }}
      />

      {/* TLDRAW FULLSCREEN */}
      <Tldraw
        key={editorKey}
        components={{ Scribble: LaserScribble }}
        onMount={(editor) => {
          editor.updateInstanceState({ isDebugMode: false });
          window.editor = editor;
          editor.setCurrentTool("draw");
          editor.setStyleForNextShapes(DefaultSizeStyle, "xl");
        }}
      />
    </div>
  );
}
