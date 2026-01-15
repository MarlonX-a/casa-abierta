import "./App.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { CLUB_BRAND } from "./clubBrand";

import "@tensorflow/tfjs-backend-webgl";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import React, { useState, useEffect } from "react";
import CanvasComponent from "./components/canvas";
import { Analytics } from "@vercel/analytics/react";

let detector;

const DEV_MODE = false;
const MODEL_PATH = process.env.PUBLIC_URL + "/models/gesture_recognizer.task";

function BrandHeader() {
  return (
    <div className="pointer-events-none fixed left-0 top-0 z-50 w-full">
      <div className="mx-auto flex max-w-6xl items-center justify-center p-6">
        <div
          className="flex items-center gap-4 rounded-3xl px-6 py-3 shadow-2xl backdrop-blur-lg"
          style={{
            background: "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(249,240,255,0.9))",
            border: `2px solid ${CLUB_BRAND.primary}40`,
            boxShadow: "0 12px 30px rgba(124, 58, 237, 0.22)",
          }}
        >
          <img
            src={CLUB_BRAND.logoUrl}
            alt={CLUB_BRAND.name}
            className="h-16 w-16 rounded-2xl bg-white p-2 shadow-2xl"
            style={{ objectFit: "cover" }}
          />

          <div className="flex flex-col leading-tight">
            <div
              className="text-2xl font-extrabold tracking-tight"
              style={{ color: CLUB_BRAND.primary }}
            >
              {CLUB_BRAND.name}
            </div>

            <div className="text-sm font-medium opacity-90">
              {CLUB_BRAND.tagline}
            </div>

            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold shadow-sm">
              <span>✨ Casa Abierta</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/60">Demo</span>
            </div>
          </div>
        </div>

        {/* Clear button card placed next to the brand card (outside of it) */}
        <div className="pointer-events-auto ml-4">
          <button id="clear-btn" className="clear-card clear-btn" onClick={() => {
            // fallback manual clear: dispatch a custom event the canvas listens to
            const ev = new CustomEvent('manualClear');
            window.dispatchEvent(ev);
          }}>
            <div className="clear-inner"><span className="clear-icon">🧹</span><span>Borrar</span></div>
          </button>
        </div>
      </div>
    </div>
  );
}

function CornerRibbon() {
  return (
    <div className="pointer-events-none fixed right-0 top-0 z-50">
      <div
        className="origin-top-right rotate-45 translate-x-16 translate-y-6 px-16 py-2 text-xs font-extrabold tracking-wider text-white shadow-lg"
        style={{ background: "var(--club-primary)" }}
      >
        CLUB IA • DEMO
      </div>
    </div>
  );
}

function Watermark() {
  return (
    <div
      className="pointer-events-none flex items-center justify-center"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110000,
        pointerEvents: "none",
      }}
    >
      <img
        src={CLUB_BRAND.logoUrl}
        alt={CLUB_BRAND.name}
        aria-hidden="true"
        draggable={false}
        className="select-none"
          style={{
            width: "56vw",
            maxWidth: "800px",
            opacity: 0.08,
            objectFit: "contain",
            filter: "grayscale(100%)",
          }}
      />
    </div>
  );
}

function App() {
  const [isModelLoaded, setModelLoaded] = useState(false);

  useEffect(() => {
    async function setupModel() {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      detector = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,  // Solo una mano para mejor rendimiento
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        customGesturesClassifierOptions: { scoreThreshold: 0.5 },
      });

      setModelLoaded(true);
    }

    setupModel();
  }, []);

  return (
    <div
      className="relative flex flex-col h-screen"
      style={{ background: "transparent" }}
    >
      <Analytics />

      {/* ✅ Branding visible */}
      <BrandHeader />
      <CornerRibbon />

      {/* ✅ Más espacio arriba por el header grande */}
      <div className="relative flex-1 pt-28">
        {/* ✅ Marca de agua */}
        <Watermark />

        <CanvasComponent
          detector={detector}
          isModelLoaded={isModelLoaded}
          development={DEV_MODE}
        />
      </div>
    </div>
  );
}

export default App;
