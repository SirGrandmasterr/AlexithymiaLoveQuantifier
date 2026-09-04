import { resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');

export const today = (now = new Date()) => [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
].join('-');
