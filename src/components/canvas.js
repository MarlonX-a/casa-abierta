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

/* =========================
   CONFIG PERFORMANCE
========================= */
const TARGET_FPS = 24;
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

  const [isStreaming, setStreaming] = useState(false);
  const [isDrawing, setDrawing] = useState(false);

  const drawingPointsRef = useRef([]);
  const lastVideoTimeRef = useRef(-1);
  const lastProcessTimeRef = useRef(0);
  const previousGestureRef = useRef(null);

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
    return (
      euclideanDistance([
        [trackingPoint.x, previousPoint.x],
        [trackingPoint.y, previousPoint.y],
      ]) >= 0.002
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

      if (gesture === "index_pinch" && trackingPoint) {
        if (drawingPointsRef.current.length > 0) {
          const previousPoint =
            drawingPointsRef.current[drawingPointsRef.current.length - 1];
          if (!nextDrawingPointIsFarEnough(trackingPoint, previousPoint)) return;
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
          frameRate: 30,
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
     MAIN LOOP (24 FPS optimizado)
========================= */
  useAnimationFrame(() => {
    if (!detector || !videoRef.current || !floatingCanvasCtxRef.current) return;
    if (videoRef.current.readyState < 2) return;

    const now = performance.now();
    if (now - lastProcessTimeRef.current < FRAME_INTERVAL) return;
    
    // Solo procesar si hay un nuevo frame de video
    if (videoRef.current.currentTime === lastVideoTimeRef.current) return;
    
    lastProcessTimeRef.current = now;
    lastVideoTimeRef.current = videoRef.current.currentTime;

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
