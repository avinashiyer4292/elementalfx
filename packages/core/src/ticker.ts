/**
 * One shared requestAnimationFrame loop for every effect on the page.
 * Effects subscribe while they have work to do and unsubscribe when idle,
 * so a page with no active effects schedules no frames at all.
 */

/** Called once per frame with the elapsed time in seconds (capped at 0.1 s) and the frame timestamp. */
export type FrameCallback = (dt: number, now: number) => void;

const callbacks = new Set<FrameCallback>();
let frameId = 0;
let lastTime = 0;

function frame(now: number): void {
  frameId = 0;
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
  lastTime = now;
  for (const callback of Array.from(callbacks)) {
    try {
      callback(dt, now);
    } catch (error) {
      // A broken effect must not take the others down with it.
      callbacks.delete(callback);
      console.error('[elementalfx] An effect threw during a frame and was stopped.', error);
    }
  }
  if (callbacks.size > 0) frameId = requestAnimationFrame(frame);
  else lastTime = 0;
}

/** Subscribes to the shared frame loop. Returns an unsubscribe function. */
export function onFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  if (!frameId) frameId = requestAnimationFrame(frame);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    }
  };
}

/** Number of effects currently subscribed to the loop. Useful in tests. */
export function activeFrameCallbacks(): number {
  return callbacks.size;
}
