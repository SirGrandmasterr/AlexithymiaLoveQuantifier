/**
 * Where the repository is, and what day it is here.
 *
 * Two lines that would sit naturally in `load.mjs` and deliberately do not: `load.mjs`
 * imports esbuild, esbuild refuses to initialise under jsdom, and `npm test` runs in jsdom.
 * Keeping these here is what lets `audio.mjs`, `pins.mjs` and their tests be part of the fast
 * suite while the model harness around them stays out of it.
 */
import { resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');

/**
 * The operator's calendar day, not UTC's.
 *
 * A report and a lock file are named for, and stamped with, the day the run happened on the
 * machine it happened on. `toISOString()` would put a run at half past midnight in Berlin
 * under yesterday's date, and a dated file in `product_vision/eval/` is a claim about a day.
 */
export const today = (now = new Date()) => [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
].join('-');
