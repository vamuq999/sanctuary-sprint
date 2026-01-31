"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Wave = { id: number; y: number; gapX: number; gapW: number; speed: number };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function Page() {
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const t0Ref = useRef<number>(performance.now());

  // Player state (simulation)
  const pxRef = useRef<number>(0.5); // 0..1
  const velRef = useRef<number>(0);  // horizontal drift
  const dashRef = useRef<number>(0); // dash impulse
  const chargeRef = useRef<number>(0); // 0..1
  const aliveRef = useRef<boolean>(true);

  // Waves
  const wavesRef = useRef<Wave[]>([]);
  const waveIdRef = useRef<number>(1);

  // Scoring + telemetry
  const scoreRef = useRef<number>(0);
  const bestRef = useRef<number>(0);
  const streakRef = useRef<number>(0);
  const hitsRef = useRef<number>(0);
  const nearMissRef = useRef<number>(0);

  // UI state
  const [ui, setUi] = useState(() => ({
    score: 0,
    best: 0,
    streak: 0,
    status: "READY" as "READY" | "LIVE" | "DOWN",
    msg: "Hold to charge. Release to dash through the gap.",
    sessionSec: 0,
    intensity: 1,
  }));

  const [dims, setDims] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  function reset(runMsg?: string) {
    pxRef.current = 0.5;
    velRef.current = 0;
    dashRef.current = 0;
    chargeRef.current = 0;
    aliveRef.current = true;

    wavesRef.current = [];
    waveIdRef.current = 1;

    scoreRef.current = 0;
    streakRef.current = 0;
    hitsRef.current = 0;
    nearMissRef.current = 0;

    t0Ref.current = performance.now();

    setUi((p) => ({
      ...p,
      score: 0,
      streak: 0,
      status: "LIVE",
      msg: runMsg ?? "Flow state: breathe, charge, dash.",
      sessionSec: 0,
      intensity: 1,
    }));
  }

  // Build a new wave near bottom
  function spawnWave() {
    const id = waveIdRef.current++;
    const gapW = clamp(0.26 - scoreRef.current * 0.0006, 0.12, 0.26);
    const gapX = clamp(0.15 + Math.random() * 0.70, 0.1, 0.9);
    const speed = clamp(0.35 + scoreRef.current * 0.00015, 0.35, 1.15);
    wavesRef.current.push({ id, y: 1.15, gapX, gapW, speed });
  }

  // Input handlers (hold to charge, release to dash)
  const holdingRef = useRef(false);

  function onHoldStart() {
    if (ui.status === "READY" || ui.status === "DOWN") reset("RUN.");
    holdingRef.current = true;
  }

  function onHoldEnd() {
    holdingRef.current = false;

    // Convert charge to dash impulse
    const c = chargeRef.current;
    if (aliveRef.current) {
      dashRef.current = clamp(dashRef.current + (0.35 + c * 1.2), 0, 1.6);
    }
    chargeRef.current = 0;
  }

  // Resize
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Main loop
  useEffect(() => {
    // initial best load
    try {
      const b = Number(localStorage.getItem("sanctuary_best") ?? "0");
      bestRef.current = isFinite(b) ? b : 0;
      setUi((p) => ({ ...p, best: bestRef.current }));
    } catch {}

    function tick(now: number) {
      const dt = Math.min(0.033, (now - (lastRef.current || now)) / 1000);
      lastRef.current = now;

      if (ui.status === "LIVE") {
        // Charge while holding
        if (holdingRef.current) {
          chargeRef.current = clamp(chargeRef.current + dt * 0.85, 0, 1);
        } else {
          chargeRef.current = clamp(chargeRef.current - dt * 1.3, 0, 1);
        }

        // Passive drift
        const drift = (Math.sin(now * 0.0012) * 0.02);
        velRef.current += drift * dt;

        // Apply dash (horizontal nudge)
        if (dashRef.current > 0) {
          const impulse = dashRef.current * (holdingRef.current ? 0.25 : 1.0);
          velRef.current += (impulse * dt) * 1.8;
          dashRef.current = clamp(dashRef.current - dt * 1.6, 0, 2);
        }

        // Dampen velocity and update position
        velRef.current *= Math.pow(0.08, dt);
        pxRef.current = clamp(pxRef.current + velRef.current, 0.06, 0.94);

        // Spawn waves
        const waves = wavesRef.current;
        if (waves.length === 0) spawnWave();
        const last = waves[waves.length - 1];
        if (last && last.y < 0.65) spawnWave();

        // Move waves upward
        for (const w of waves) {
          w.y -= dt * w.speed;
        }

        // Collision: when a wave crosses player band (near y=0.22)
        const playerY = 0.22;
        for (const w of waves) {
          const crossing = (w.y <= playerY && w.y > playerY - dt * w.speed);
          if (!crossing) continue;

          const gapLeft = w.gapX - w.gapW / 2;
          const gapRight = w.gapX + w.gapW / 2;

          const px = pxRef.current;
          const inside = (px >= gapLeft && px <= gapRight);

          if (inside) {
            // success
            hitsRef.current += 1;
            streakRef.current += 1;

            // near-miss bonus if close to edges
            const edgeDist = Math.min(px - gapLeft, gapRight - px);
            if (edgeDist < 0.03) {
              nearMissRef.current += 1;
              scoreRef.current += 9;
            }

            scoreRef.current += 18 + Math.floor(streakRef.current * 0.9);
          } else {
            // fail
            aliveRef.current = false;
            setUi((p) => ({
              ...p,
              status: "DOWN",
              msg: "Down. Breathe. Tap + hold to restart.",
            }));
          }
        }

        // Remove offscreen waves
        wavesRef.current = waves.filter((w) => w.y > -0.2);

        // Update best
        if (scoreRef.current > bestRef.current) {
          bestRef.current = scoreRef.current;
          try {
            localStorage.setItem("sanctuary_best", String(bestRef.current));
          } catch {}
        }

        // UI snapshot (throttle a bit)
        const sessionSec = Math.floor((now - t0Ref.current) / 1000);
        const intensity = clamp(1 + scoreRef.current / 800, 1, 2.25);

        setUi((p) => ({
          ...p,
          score: scoreRef.current,
          best: bestRef.current,
          streak: streakRef.current,
          sessionSec,
          intensity,
        }));
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.status]);

  // Visual helpers
  const px = pxRef.current;
  const charge = chargeRef.current;
  const waves = wavesRef.current;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
      }}
      onPointerDown={(e) => { e.preventDefault(); onHoldStart(); }}
      onPointerUp={(e) => { e.preventDefault(); onHoldEnd(); }}
      onPointerCancel={(e) => { e.preventDefault(); onHoldEnd(); }}
      onPointerLeave={(e) => { e.preventDefault(); onHoldEnd(); }}
    >
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        inset: -60,
        background:
          "radial-gradient(700px 500px at 50% 30%, rgba(120,210,255,0.10), transparent 60%)," +
          "radial-gradient(500px 400px at 20% 70%, rgba(160,120,255,0.09), transparent 60%)," +
          "radial-gradient(500px 500px at 80% 80%, rgba(80,255,180,0.06), transparent 60%)",
        filter: prefersReducedMotion ? "none" : `blur(${18 + ui.intensity * 6}px)`,
        opacity: 0.95,
        pointerEvents: "none",
      }} />

      {/* Top HUD */}
      <div style={{
        position: "absolute",
        top: 14,
        left: 14,
        right: 14,
        display: "flex",
        gap: 10,
        alignItems: "stretch",
        zIndex: 5,
      }}>
        <HudCard title="SCORE" value={ui.score} sub={`BEST ${ui.best}`} />
        <HudCard title="STREAK" value={ui.streak} sub={`TIME ${ui.sessionSec}s`} />
      </div>

      {/* Center message */}
      <div style={{
        position: "absolute",
        top: 92,
        left: 14,
        right: 14,
        zIndex: 5,
        padding: "12px 14px",
        borderRadius: 16,
        background: "linear-gradient(180deg, var(--glass), var(--glass2))",
        border: "1px solid rgba(140,180,255,0.22)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
        backdropFilter: "blur(10px)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 800, letterSpacing: 0.6 }}>
            SANCTUARY SPRINT
          </div>
          <div style={{
            fontSize: 12,
            color: "var(--muted)",
            letterSpacing: 0.4,
          }}>
            {ui.status}
          </div>
        </div>
        <div style={{ marginTop: 6, color: "var(--muted)", lineHeight: 1.25 }}>
          {ui.msg}
        </div>
      </div>

      {/* Arena */}
      <div style={{
        position: "absolute",
        inset: 0,
        paddingTop: 150,
        paddingBottom: 18,
        zIndex: 2,
      }}>
        <div style={{
          position: "absolute",
          left: "50%",
          top: 150,
          bottom: 18,
          width: 1,
          transform: "translateX(-0.5px)",
          background: "rgba(140,180,255,0.12)",
          pointerEvents: "none",
        }} />

        {/* Waves */}
        {waves.map((w) => {
          const yPx = (1 - w.y) * (dims.h - 180) + 160;
          const left = (w.gapX - w.gapW / 2) * dims.w;
          const right = (w.gapX + w.gapW / 2) * dims.w;

          return (
            <React.Fragment key={w.id}>
              <Bar x={0} y={yPx} w={left} h={10} />
              <Bar x={right} y={yPx} w={dims.w - right} h={10} />
              {/* gap hint */}
              <div style={{
                position: "absolute",
                left,
                top: yPx - 6,
                width: Math.max(10, right - left),
                height: 22,
                borderRadius: 14,
                border: "1px dashed rgba(120,210,255,0.25)",
                background: "rgba(120,210,255,0.03)",
                pointerEvents: "none",
              }} />
            </React.Fragment>
          );
        })}

        {/* Player band */}
        <div style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: (1 - 0.22) * (dims.h - 180) + 160,
          height: 1,
          background: "rgba(255,255,255,0.07)",
          pointerEvents: "none",
        }} />

        {/* Player orb */}
        <div style={{
          position: "absolute",
          left: `${px * 100}%`,
          top: (1 - 0.22) * (dims.h - 180) + 160,
          transform: "translate(-50%, -50%)",
          width: 26 + charge * 24,
          height: 26 + charge * 24,
          borderRadius: 999,
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(120,210,255,0.55) 35%, rgba(160,120,255,0.25) 60%, rgba(0,0,0,0) 75%)`,
          boxShadow:
            `0 0 ${28 + charge * 60}px rgba(120,210,255,0.35),` +
            `0 0 ${18 + charge * 35}px rgba(160,120,255,0.22)`,
          border: "1px solid rgba(140,180,255,0.30)",
          opacity: aliveRef.current ? 1 : 0.45,
          pointerEvents: "none",
        }} />

        {/* Charge meter */}
        <div style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: 14,
          zIndex: 5,
          padding: 12,
          borderRadius: 16,
          background: "linear-gradient(180deg, rgba(10,18,44,0.62), rgba(10,18,44,0.38))",
          border: "1px solid rgba(140,180,255,0.22)",
          backdropFilter: "blur(10px)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              HOLD = CHARGE • RELEASE = DASH
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              INT {ui.intensity.toFixed(2)}x
            </div>
          </div>
          <div style={{
            height: 12,
            borderRadius: 999,
            background: "rgba(140,180,255,0.10)",
            border: "1px solid rgba(140,180,255,0.16)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${Math.round(charge * 100)}%`,
              background:
                "linear-gradient(90deg, rgba(80,255,180,0.55), rgba(120,210,255,0.85), rgba(160,120,255,0.70))",
              boxShadow: "0 0 22px rgba(120,210,255,0.35)",
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HudCard({ title, value, sub }: { title: string; value: number; sub: string }) {
  return (
    <div style={{
      flex: 1,
      padding: "12px 14px",
      borderRadius: 18,
      background: "linear-gradient(180deg, rgba(10,18,44,0.62), rgba(10,18,44,0.35))",
      border: "1px solid rgba(140,180,255,0.22)",
      boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
      backdropFilter: "blur(10px)",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, letterSpacing: 1.2, color: "var(--muted)" }}>
        {title}
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {sub}
      </div>
    </div>
  );
}

function Bar({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  if (w <= 0) return null;
  return (
    <div style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: 999,
      background: "linear-gradient(90deg, rgba(120,210,255,0.10), rgba(120,210,255,0.22), rgba(160,120,255,0.10))",
      border: "1px solid rgba(140,180,255,0.18)",
      boxShadow: "0 0 30px rgba(120,210,255,0.08)",
      pointerEvents: "none",
    }} />
  );
}