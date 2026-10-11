import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import "./../css/swipe.css";

const THRESHOLD = 56;
const MAX_DRAG = 140;
const LOCK_DEAD_ZONE = 6;

// Tap is handled by the browser's own native "click" event (reliable,
// single-fire, well understood). Pointer events are only used to track the
// swipe-to-complete drag distance and the long-press timer. We only ever
// suppress the click that follows a *genuinely completed* swipe or a fired
// long-press, using a short-lived one-shot flag — everything else (a tap,
// or an ambiguous/failed swipe attempt) falls through to a normal click.
export default function SwipeToComplete({
  done,
  onComplete,
  onLongPress,
  onTap,
  longPressMs = 2000,
  children,
  className = "",
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [holding, setHolding] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const activeRef = useRef(false);
  const lockedRef = useRef(null); // "x" | "y" | null
  const dragXRef = useRef(0);
  const longPressFiredRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => () => clearLongPressTimer(), []);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setHolding(false);
  }

  function reset() {
    activeRef.current = false;
    lockedRef.current = null;
    dragXRef.current = 0;
    setDragging(false);
    setDragX(0);
  }

  function handlePointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // some pointer types/browsers may not support capture; safe to ignore
    }
    activeRef.current = true;
    lockedRef.current = null;
    longPressFiredRef.current = false;
    dragXRef.current = 0;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;

    if (onLongPress) {
      setHolding(true);
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        suppressNextClickRef.current = true;
        reset();
        setHolding(false);
        onLongPress();
      }, longPressMs);
    }
  }

  function handlePointerMove(e) {
    if (!activeRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    if (Math.abs(dx) > LOCK_DEAD_ZONE || Math.abs(dy) > LOCK_DEAD_ZONE) {
      clearLongPressTimer();
    }

    if (done) return;

    if (!lockedRef.current) {
      if (Math.abs(dx) < LOCK_DEAD_ZONE && Math.abs(dy) < LOCK_DEAD_ZONE) return;
      lockedRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (lockedRef.current === "x") setDragging(true);
    }

    if (lockedRef.current === "x") {
      const clamped = Math.max(0, Math.min(dx, MAX_DRAG));
      dragXRef.current = clamped;
      setDragX(clamped);
    }
  }

  function handlePointerUp(e) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture was never set or already released
    }
    if (!activeRef.current) return;
    clearLongPressTimer();

    const wasLongPress = longPressFiredRef.current;
    const lock = lockedRef.current;
    const finalDragX = dragXRef.current;
    reset();

    if (wasLongPress) return; // already handled by the timer callback
    if (!done && lock === "x" && finalDragX > THRESHOLD) {
      suppressNextClickRef.current = true;
      onComplete?.();
    }
    // Anything else (a tap, a vertical scroll, or a swipe that didn't reach
    // the threshold) is left alone: the browser's own click event — if
    // any — will fire next and drive onTap.
  }

  function handlePointerCancel() {
    if (!activeRef.current) return;
    clearLongPressTimer();
    reset();
  }

  function handleClick(e) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onTap?.();
  }

  return (
    <div className={`swipe-complete ${className}`}>
      <div
        className="swipe-complete-bg"
        style={{ opacity: Math.min(dragX / THRESHOLD, 1) }}
        aria-hidden="true"
      >
        <Icon name="check" size={20} />
      </div>
      <div
        className={`swipe-complete-content${holding ? " swipe-complete-holding" : ""}`}
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragging ? "none" : "transform 0.2s ease",
          "--hold-duration": `${longPressMs}ms`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
}
