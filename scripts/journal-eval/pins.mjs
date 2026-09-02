/**
 * The model revisions, read out of the Makefile rather than typed here.
 *
 * §5.6 puts the pins in the Makefile so that "adding a model is editing a table and never
 * editing logic". A report that names a revision has to name *that* revision — the one the
 * operator's `make models-fetch` actually pulled — and the only way to be sure of it is to
 * read the same table. A second copy in this directory would be right on the day it was
 * written and silently wrong after the next re-pin.
 *
 * Nothing here fails a run: a candidate whose revision cannot be found is reported with
 * `revision: null` and the report prints *"not pinned in the Makefile"*, which is itself the
 * useful fact when somebody tries to evaluate a model nobody has pinned yet.
 */
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

/**
 * The pinned revision for a model set, or `null`.
 *
 * `null` is a real answer and not an error: `gemma-4-e4b-onnx` is deliberately absent, which
 * is exactly what makes the "is E4B a desktop default" question a question and not a run.
 */
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
