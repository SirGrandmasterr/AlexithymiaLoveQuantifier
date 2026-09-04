import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from './paths.mjs';

/** `<SET>_REV := <hex>` in the Makefile, by the name §5.6's table uses. */
const REV_FOR_SET = {
    'whisper-tiny': 'WHISPER_TINY_REV',
    'gemma-4-e2b-onnx': 'GEMMA_E2B_ONNX_REV',
    'gemma-4-e2b-litertlm': 'GEMMA_E2B_LITERTLM_REV'
};

let cache = null;

const readMakefile = async () => {
    if (cache) return cache;
    const text = await readFile(join(repoRoot, 'Makefile'), 'utf8');
    cache = new Map([...text.matchAll(/^([A-Z0-9_]+_REV)\s*:=\s*(\S+)\s*$/gm)]
        .map(match => [match[1], match[2]]));
    return cache;
};

export const revisionFor = async (modelSet) => {
    if (!modelSet) return null;
    const variable = REV_FOR_SET[modelSet];
    if (!variable) return null;
    return (await readMakefile()).get(variable) || null;
};

/** Every set the Makefile knows how to fetch, for the report's "what was available" line. */
export const pinnedSets = async () => {
    const makefile = await readMakefile();
    return Object.entries(REV_FOR_SET)
        .filter(([, variable]) => makefile.has(variable))
        .map(([set, variable]) => ({ set, revision: makefile.get(variable) }));
};
