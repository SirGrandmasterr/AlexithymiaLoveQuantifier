import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
    WHISPER_TINY,
    EMBEDDING_GEMMA_ONNX,
    GEMMA_E4B_LITERTLM,
    GEMMA_E4B_ONNX,
    MODEL_BASE_PATH,
    modelFileUrl,
    totalBytes,
    formatBytes,
    modelSize,
    tierModels
} from './models';

const makefile = readFileSync('Makefile', 'utf8');

/** Every `<set>|path|url|sha256` row of `MODEL_MANIFEST`, with `$(VAR)` expanded. */
const manifestRows = (set = 'whisper-tiny') => {
    const variables = {};
    for (const [, name, value] of makefile.matchAll(/^([A-Z0-9_]+) :?= (.+?)\s*$/gm)) {
        variables[name] = value;
    }
    const expand = (text) => {
        let out = text;
        for (let pass = 0; pass < 4 && out.includes('$('); pass += 1) {
            out = out.replace(/\$\(([A-Z0-9_]+)\)/g, (whole, name) => variables[name] ?? whole);
        }
        return out;
    };

    // The sum is matched as a variable-or-literal and then expanded: the licence row pins
    // the one left out is the licence Apache 2.0 §4(a) requires to travel with the copy.
    const pattern = new RegExp(`^\\t${set}\\|(\\S+?)\\|(\\S+?)\\|(\\S+?)\\s*\\\\?\\r?$`, 'gm');
    return [...makefile.matchAll(pattern)]
        .map(([, path, url, sha256]) => ({
            path: expand(path), url: expand(url), sha256: expand(sha256)
        }));
};

describe('the pinned manifest', () => {
    it('reads the Makefile it is asserting against', () => {
        // The guard: a renamed variable or a reformatted table would otherwise make every
        // assertion below pass over an empty list.
        expect(makefile).toContain('MODEL_MANIFEST');
        expect(manifestRows().length).toBeGreaterThan(10);
    });

    it('holds the same files and the same sums as the Makefile, in both directions', () => {
        const rows = manifestRows();
        const fromMake = Object.fromEntries(rows.map(row => [row.path, row.sha256]));
        const fromApp = Object.fromEntries(WHISPER_TINY.files.map(file => [file.path, file.sha256]));

        expect(fromApp).toEqual(fromMake);
    });

    it('pins the revision the Makefile pins, not a branch', () => {
        expect(makefile).toContain(`WHISPER_TINY_REV := ${WHISPER_TINY.revision}`);
        manifestRows().forEach(row => {
            if (row.url.includes('huggingface.co')) expect(row.url).toContain(WHISPER_TINY.revision);
        });
    });

    it('mirrors the repo id in the path, which is what transformers.js resolves', () => {
        WHISPER_TINY.files.forEach(file => {
            expect(file.path.startsWith(`${WHISPER_TINY.id}/`)).toBe(true);
        });
    });

    it('asks for the two quantised files the q8 dtype selects', () => {
        expect(WHISPER_TINY.dtype).toBe('q8');
        const weights = WHISPER_TINY.files.filter(file => file.path.endsWith('.onnx'));
        expect(weights.map(file => file.path.split('/').pop())).toEqual([
            'encoder_model_quantized.onnx',
            'decoder_model_merged_quantized.onnx'
        ]);
    });

    it('carries the licence beside the weights, as Apache 2.0 §4(a) wants', () => {
        expect(WHISPER_TINY.licence).toBe('Apache 2.0');
        expect(WHISPER_TINY.files.some(file => file.path.endsWith('LICENSE.txt'))).toBe(true);
    });
});

describe('sizes', () => {
    it('is the 45 MB C1 measured, to the byte', () => {
        // 45,245,009 bytes over thirteen files, `make models-fetch`, 2026-08-25 and again on
        // 2026-08-31. This is the number the settings screen promises before it downloads.
        expect(totalBytes(WHISPER_TINY)).toBe(45_245_009);
        expect(modelSize(WHISPER_TINY)).toBe('45 MB');
    });

    it('counts the two weight files as 40.8 MB of the total', () => {
        const weights = WHISPER_TINY.files
            .filter(file => file.path.endsWith('.onnx'))
            .reduce((sum, file) => sum + file.bytes, 0);
        expect(weights).toBe(40_844_231);
    });

    it('says megabytes the way a transfer dialog does', () => {
        expect(formatBytes(45_245_009)).toBe('45 MB');
        expect(formatBytes(11_358)).toBe('11 kB');
        expect(formatBytes(0)).toBe('1 kB');
        expect(formatBytes(-1)).toBe('');
        expect(formatBytes(Number.NaN)).toBe('');
    });
});

describe('where the files come from', () => {
    it('is this app own origin, as a relative path with no host in it', () => {
        expect(MODEL_BASE_PATH).toBe('/models/');
        WHISPER_TINY.files.forEach(file => {
            const url = modelFileUrl(file);
            expect(url.startsWith('/models/')).toBe(true);
            expect(url).not.toMatch(/^https?:/);
        });
    });

    it('names no model hub anywhere in the table the browser reads', () => {
        const serialized = JSON.stringify(WHISPER_TINY);
        expect(serialized).not.toContain('huggingface');
        expect(serialized).not.toContain('http');
    });
});

/* G1 — EmbeddingGemma, and the licence that is not Apache */

/**
 * The same rail, for the index's model — and one row it deliberately cannot cover.
 *
 * Seven of EmbeddingGemma's eight files are pinned in `MODEL_MANIFEST` like every other
 * weight. The eighth is `GEMMA_TERMS_OF_USE.txt`, which has **no pinnable URL**: Google
 * publishes the Gemma terms as an HTML page that is not byte-stable, and two fetches seconds
 * apart on 2026-09-04 hashed differently. So the copy lives in `licences/` in this
 * repository, `make models-install-terms` puts it in the volume beside the weights, and the
 * test below hashes the file itself. That is a stronger rail than a URL pin, not a weaker
 * one: it fails on a change to the bytes this repository actually ships.
 */
describe('the index model manifest', () => {
    it('holds the same files and the same sums as the Makefile, in both directions', () => {
        const rows = manifestRows('embeddinggemma');
        expect(rows.length).toBeGreaterThan(5);

        const fromMake = Object.fromEntries(rows.map(row => [row.path, row.sha256]));
        const fromApp = Object.fromEntries(
            EMBEDDING_GEMMA_ONNX.files
                // The terms are installed from this repository, not fetched, so they are not
                // a manifest row — see the block comment above and the `licences/` test below.
                .filter(file => !file.path.endsWith('GEMMA_TERMS_OF_USE.txt'))
                .map(file => [file.path, file.sha256])
        );

        expect(fromApp).toEqual(fromMake);
    });

    it('pins the revision the Makefile pins, not a branch', () => {
        expect(makefile).toContain(`EMBEDDING_GEMMA_REV := ${EMBEDDING_GEMMA_ONNX.revision}`);
        manifestRows('embeddinggemma').forEach(row => {
            expect(row.url).toContain(EMBEDDING_GEMMA_ONNX.revision);
        });
    });

    it('mirrors the repo id in the path, which is what transformers.js resolves', () => {
        EMBEDDING_GEMMA_ONNX.files.forEach(file => {
            expect(file.path.startsWith(`${EMBEDDING_GEMMA_ONNX.id}/`)).toBe(true);
        });
    });

    it('is 219 MB over eight files, measured 2026-09-04', () => {
        expect(EMBEDDING_GEMMA_ONNX.files).toHaveLength(8);
        expect(totalBytes(EMBEDDING_GEMMA_ONNX)).toBe(218_739_216);
        expect(modelSize(EMBEDDING_GEMMA_ONNX)).toBe('219 MB');
    });

    it('is not a tier model: no tier downloads it as part of turning voice on', () => {
        ['full', 'light', 'text-only'].forEach(tier => {
            [true, false].forEach(native => {
                expect(tierModels(tier, { native })).not.toContain(EMBEDDING_GEMMA_ONNX);
            });
        });
    });

    it('names no model hub in the table the browser reads', () => {
        const serialized = JSON.stringify(EMBEDDING_GEMMA_ONNX);
        expect(serialized).not.toContain('huggingface');
        expect(serialized).not.toContain('http');
    });
});

describe('the Gemma Terms of Use', () => {
    // The bytes as `make models-install-terms` installs them: `tr -d '\r'`, so the volume
    // holds the LF form whatever this repository was cloned as.
    const terms = readFileSync('licences/gemma-terms-of-use.txt', 'utf8').replace(/\r/g, '');
    const row = EMBEDDING_GEMMA_ONNX.files.find(file => file.path.endsWith('GEMMA_TERMS_OF_USE.txt'));

    it('travels with the weights, because Section 3.1 of the terms requires it to', () => {
        expect(EMBEDDING_GEMMA_ONNX.licence).toBe('Gemma Terms of Use');
        expect(row).toBeTruthy();
        expect(terms).toContain('Gemma Terms of Use');
        // The Appendix is what makes these the right terms for *this* model.
        expect(terms).toContain('EmbeddingGemma');
    });

    it('is the file this repository ships, to the byte', () => {
        const bytes = Buffer.from(terms, 'utf8');
        expect(row.bytes).toBe(bytes.length);
        expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is installed into the volume by a target `models-fetch` actually runs', () => {
        expect(makefile).toContain('GEMMA_TERMS_FILE := licences/gemma-terms-of-use.txt');
        expect(makefile).toContain('models-install-terms');
        // Not a manifest row: it has no URL to pin, and a placeholder sum would fail the
        // fetch script's own check rather than being caught here.
        expect(makefile).not.toContain('embeddinggemma|$(EMBEDDING_GEMMA_DIR)/GEMMA_TERMS_OF_USE.txt');
    });

    it('says where it came from, so the copy can be checked against the source', () => {
        expect(terms).toContain('https://ai.google.dev/gemma/terms');
        expect(terms).toContain('Retrieved  2026-09-04');
    });
});

describe('the Gemma 4 E4B LiteRT-LM manifest', () => {
    it('holds the same files and sums as the Makefile', () => {
        const rows = manifestRows('gemma-4-e4b-litertlm');
        expect(rows.length).toBe(2);

        const fromMake = Object.fromEntries(rows.map(row => [row.path, row.sha256]));
        const fromApp = Object.fromEntries(GEMMA_E4B_LITERTLM.files.map(file => [file.path, file.sha256]));
        expect(fromApp).toEqual(fromMake);
    });

    it('pins the revision the Makefile pins', () => {
        expect(makefile).toContain(`GEMMA_E4B_LITERTLM_REV := ${GEMMA_E4B_LITERTLM.revision}`);
    });

    it('carries the licence beside the model weights', () => {
        expect(GEMMA_E4B_LITERTLM.licence).toBe('Apache 2.0');
        expect(GEMMA_E4B_LITERTLM.files.some(file => file.path.endsWith('LICENSE.txt'))).toBe(true);
    });
});

describe('the Gemma 4 E4B ONNX manifest', () => {
    it('holds the same files and sums as the Makefile', () => {
        const rows = manifestRows('gemma-4-e4b-onnx');
        expect(rows.length).toBe(17);

        const fromMake = Object.fromEntries(rows.map(row => [row.path, row.sha256]));
        const fromApp = Object.fromEntries(GEMMA_E4B_ONNX.files.map(file => [file.path, file.sha256]));
        expect(fromApp).toEqual(fromMake);
    });

    it('pins the revision the Makefile pins', () => {
        expect(makefile).toContain(`GEMMA_E4B_ONNX_REV := ${GEMMA_E4B_ONNX.revision}`);
    });
});
