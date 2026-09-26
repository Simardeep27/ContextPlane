import { randomUUID } from 'node:crypto';

// Owned by the launcher, never detached. No overlapping delivery ticks; shutdown
// drains any in-flight tick before the launcher records its final SessionEnd.
export function startHeartbeat({ boxes, deliver, isAlive, onError,
  schedule = setInterval, cancel = clearInterval }) {
  let stopped = false, pending;
  async function tick() {
    if (stopped || pending || !isAlive()) return;
    pending = (async () => {
      for (const box of boxes()) {
        if (stopped || !isAlive()) break;
        try {
          // Retry durable reports before generating another heartbeat. A failed
          // transport must not consume the bounded spool every minute.
          if (box.read().pending.length) await deliver(box);
          if (stopped || !isAlive()) break;
          const id = await box.enqueue({ kind: 'Heartbeat', key: `heartbeat:${randomUUID()}`,
            summary: 'Launcher observed client process alive; task outcome not verified' });
          if (id) await deliver(box);
        } catch { onError(); }
      }
    })();
    try { await pending; } catch { onError(); } finally { pending = undefined; }
  }
  const timer = schedule(tick, 60_000);
  timer?.unref?.();
  return async () => { stopped = true; cancel(timer); await pending; };
}
