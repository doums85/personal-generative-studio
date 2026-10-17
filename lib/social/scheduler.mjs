import { runDuePublications } from './service.mjs';
import { schedulerStatus } from './schedule.mjs';
import { getSocialStore } from './store.mjs';

const KEY = Symbol.for('personal-generative-studio.social-scheduler');

/** Starts the once-a-minute ticker of a long-running server (no-op on serverless hosts or when disabled). */
export function startScheduler({ env = process.env, intervalMs = 60 * 1000, log = console } = {}) {
  if (globalThis[KEY] || schedulerStatus(env).mode !== 'interval') return false;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const touched = await runDuePublications({ social: getSocialStore(), env });
      if (touched.length) log.info(`[social-scheduler] ${touched.length} publication(s) handled`);
    } catch (error) {
      log.error('[social-scheduler]', error);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  globalThis[KEY] = timer;
  return true;
}
