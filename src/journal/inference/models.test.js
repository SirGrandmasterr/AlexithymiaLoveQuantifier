import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    WHISPER_TINY,
    MODEL_BASE_PATH,
    modelFileUrl,
    totalBytes,
    formatBytes,
    modelSize
} from './models';

/**
 * The rail that keeps the browser's copy of the manifest honest.
 *
 * `Makefile` fills the volume and this table verifies what was served, and the two only mean
 * anything together — so a test reads the Makefile and asserts they agree, exactly as
 * `journal.test.js` reads `domain/journal.go` for the feeling ids. Without it the second
 * check degrades into a second opinion about the first.
 */
const makefile = readFileSync('Makefile', 'utf8');

/** Every `whisper-tiny|path|url|sha256` row of `MODEL_MANIFEST`, with `$(VAR)` expanded. */
const manifestRows = () => {
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
    // `$(APACHE_20_SHA)` rather than writing the hex inline, and a first draft that only
    // accepted 64 hex characters silently dropped it — twelve of thirteen files checked, and
    // the one left out is the licence Apache 2.0 §4(a) requires to travel with the copy.
    return [...makefile.matchAll(/^\twhisper-tiny\|(\S+?)\|(\S+?)\|(\S+?)\s*\\?\r?$/gm)]
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
        // A `resolve/main/...` URL is not a pin: the bytes behind it can change while the
        // URL does not, and the sum would then fail on the next operator's first run with no
        // way to tell a re-tag from tampering.
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
        // The Makefile names Hugging Face, because that is where the operator fetches from.
        // This module must not: `connect-src 'self'` would refuse it, and the Vault page
        // says every request goes to this app's own origin.
        const serialized = JSON.stringify(WHISPER_TINY);
        expect(serialized).not.toContain('huggingface');
        expect(serialized).not.toContain('http');
    });
});
