import { isBrowser, prefersReducedMotion, watchReducedMotion } from './env';
import { onFrame, type FrameCallback } from './ticker';

export interface RuntimeOptions {
  /** Element whose visibility decides whether frames run. */
  element: Element;
  /** Per-frame work. Only called while the effect should be animating. */
  frame: FrameCallback;
  /** Stop animating while the element is scrolled out of view. Default true. */
  pauseOffscreen?: boolean;
  /** Honour `prefers-reduced-motion: reduce`. Default true. */
  respectReducedMotion?: boolean;
  /** Called when the reduced-motion state that applies to this effect changes. */
  onReducedMotionChange?: (reduce: boolean) => void;
}

/**
 * Decides when an effect animates. Frames run only while the effect is
 * playing, on screen, not idle, and motion is allowed. Tab visibility is
 * handled by requestAnimationFrame itself, which stops in hidden tabs.
 */
export class EffectRuntime {
  private playing = true;
  private onscreen = true;
  private idle = false;
  private destroyed = false;
  private reduced: boolean;
  private respectReduced: boolean;
  private unsubscribe: (() => void) | null = null;
  private observer: IntersectionObserver | null = null;
  private stopWatchingMotion: () => void;

  constructor(private readonly options: RuntimeOptions) {
    this.respectReduced = options.respectReducedMotion ?? true;
    this.reduced = this.respectReduced && prefersReducedMotion();
    this.stopWatchingMotion = watchReducedMotion((reduce) => {
      const next = this.respectReduced && reduce;
      if (next === this.reduced) return;
      this.reduced = next;
      options.onReducedMotionChange?.(next);
      this.update();
    });
    if (isBrowser && (options.pauseOffscreen ?? true) && 'IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          this.onscreen = entry.isIntersecting;
          this.update();
        },
        { rootMargin: '64px' },
      );
      this.observer.observe(options.element);
    }
    this.update();
  }

  /** True when reduced motion applies to this effect. */
  get reducedMotion(): boolean {
    return this.reduced;
  }

  /** True while frames are being delivered. */
  get running(): boolean {
    return this.unsubscribe !== null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Changes whether reduced motion is honoured, e.g. from `set({ respectReducedMotion })`. */
  setRespectReducedMotion(respect: boolean): void {
    this.respectReduced = respect;
    const next = respect && prefersReducedMotion();
    if (next !== this.reduced) {
      this.reduced = next;
      this.options.onReducedMotionChange?.(next);
    }
    this.update();
  }

  play(): void {
    this.playing = true;
    this.update();
  }

  pause(): void {
    this.playing = false;
    this.update();
  }

  /** Stops frames until `wake()`, used when an effect has settled and has nothing to draw. */
  sleep(): void {
    this.idle = true;
    this.update();
  }

  wake(): void {
    if (!this.idle) return;
    this.idle = false;
    this.update();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.stopWatchingMotion();
    this.update();
  }

  private update(): void {
    const shouldRun =
      !this.destroyed && this.playing && this.onscreen && !this.idle && !this.reduced;
    if (shouldRun && !this.unsubscribe) {
      this.unsubscribe = onFrame(this.options.frame);
    } else if (!shouldRun && this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
