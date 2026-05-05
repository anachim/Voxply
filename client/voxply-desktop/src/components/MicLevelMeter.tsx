import React, { useEffect, useRef } from "react";
import { MIC_METER_MAX } from "../constants";

export function MicLevelMeter({
  level,
  threshold,
  onChange,
}: {
  level: number;
  threshold: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function valueAt(clientX: number): number {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return threshold;
    const pct = (clientX - rect.left) / rect.width;
    const v = Math.max(0.001, Math.min(MIC_METER_MAX, pct * MIC_METER_MAX));
    return v;
  }

  function handleDown(e: React.MouseEvent) {
    dragging.current = true;
    onChange(valueAt(e.clientX));
  }

  useEffect(() => {
    function up() {
      dragging.current = false;
    }
    function move(e: MouseEvent) {
      if (!dragging.current) return;
      onChange(valueAt(e.clientX));
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onChange]);

  const fillPct = Math.min(100, (level / MIC_METER_MAX) * 100);
  const markerPct = Math.min(100, (threshold / MIC_METER_MAX) * 100);
  const triggered = level >= threshold;

  return (
    <div className="mic-meter" ref={ref} onMouseDown={handleDown}>
      <div
        className={`mic-meter-fill ${triggered ? "triggered" : ""}`}
        style={{ width: `${fillPct}%` }}
      />
      <div className="mic-meter-marker" style={{ left: `${markerPct}%` }} />
    </div>
  );
}
