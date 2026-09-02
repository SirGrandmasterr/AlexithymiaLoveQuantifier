/**
 * What the Light tier downloads, where it comes from, and what its bytes must hash to.
 *
 * This table is a **second copy** of the `MODEL_MANIFEST` in the repository's `Makefile`,
 * and that is deliberate rather than sloppy: the operator's `make models-fetch` fills the
 * volume, and the browser verifies what it was served. Two independent checks of the same
 * bytes catch a truncated volume, a half-written file and a proxy that answered with HTML,
 * none of which a single check on either side would see. `models.test.js` reads the Makefile
 * and asserts the two agree, so they cannot drift — the same rail `journal.test.js` uses to
 * hold `FEELINGS` to `domain/journal.go`.
 *
 * Every path is relative to `/models/`, which Nginx serves from the `models_data` volume
 * (C1, `docs/09-deployment.md` §2) and which is **this app's own origin**. A model hub URL
 * here would falsify the Vault page and be refused by `connect-src 'self'` a layer lower;
 * there is nothing to configure to make that happen, because there is nowhere else to look.
 *
 * The layout mirrors the Hugging Face repo id because that is what transformers.js resolves
 * against `env.localModelPath`: base, then model id, then file.
 */

/** Where Nginx serves the volume. The trailing slash is what transformers.js expects. */
export const MODEL_BASE_PATH = '/models/';

/** The Cache Storage bucket. Versioned, so a later format change can leave the old one behind. */
export const MODEL_CACHE_NAME = 'alq:journal-models:v1';

/**
 * Whisper tiny, ONNX, int8-quantised — the Light tier's transcriber (§5.5).
 *
 * `dtype: 'q8'` is what makes transformers.js ask for the two `_quantized` files below;
 * they are the only two of the thirteen that are weights, and they are 40.8 MB of the
 * 45.2 MB total.
 */
export const WHISPER_TINY = {
    id: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    // What the settings screen and the download line say out loud. Measured, not guessed:
    // C1 fetched these exact revisions on 2026-08-25 and the sum of `bytes` below is where
    // this number comes from — `totalBytes()` recomputes it rather than trusting the label.
    label: 'Whisper tiny',
    licence: 'Apache 2.0',
    dtype: 'q8',
    files: [
        { path: 'onnx-community/whisper-tiny/LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
        { path: 'onnx-community/whisper-tiny/config.json', bytes: 2243, sha256: '46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d' },
        { path: 'onnx-community/whisper-tiny/generation_config.json', bytes: 3772, sha256: 'f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1' },
        { path: 'onnx-community/whisper-tiny/preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
        { path: 'onnx-community/whisper-tiny/tokenizer.json', bytes: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
        { path: 'onnx-community/whisper-tiny/tokenizer_config.json', bytes: 282683, sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce' },
        { path: 'onnx-community/whisper-tiny/special_tokens_map.json', bytes: 2194, sha256: 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691' },
        { path: 'onnx-community/whisper-tiny/added_tokens.json', bytes: 34604, sha256: '9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1' },
        { path: 'onnx-community/whisper-tiny/vocab.json', bytes: 1036584, sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a' },
        { path: 'onnx-community/whisper-tiny/merges.txt', bytes: 493869, sha256: '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6' },
        { path: 'onnx-community/whisper-tiny/normalizer.json', bytes: 52666, sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd' },
        { path: 'onnx-community/whisper-tiny/onnx/encoder_model_quantized.onnx', bytes: 10124990, sha256: '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19' },
        { path: 'onnx-community/whisper-tiny/onnx/decoder_model_merged_quantized.onnx', bytes: 30719241, sha256: '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3' }
    ]
};

/**
 * Gemma 4 E2B IT, ONNX, q4f16 — the model that proposes, in a browser (§5.5).
 *
 * **Four sub-models, because that is what the architecture is.** transformers.js opens one
 * ONNX session per part of `Gemma4ForConditionalGeneration`: the token embedding table, the
 * merged decoder, the audio encoder and the vision encoder. Each is a small graph beside a
 * large `.onnx_data` of weights, and the pair must sit in one directory because the graph
 * names its data file from the inside.
 *
 * **3.4 GB, measured 2026-09-02** — §5.5 estimated *"2–3 GB (verify)"* and was low. The
 * measurement is the sum of `bytes` below, `totalBytes()` recomputes it rather than trusting
 * a label, and the settings screen says the recomputed number out loud before anything moves.
 * q4f16 is the floor rather than a preference: every other quantisation this export offers is
 * larger.
 *
 * The vision encoder is fetched and never used. Nothing in this app shows the model an image;
 * it is here because the model class declares the session and will not instantiate without it,
 * and because it is 99 MB of 3,401 — the wrong 3 % to fight for. `GEMMA_E2B_ONNX_TEXT` below
 * is the subset that does drop it, and that split is a real one.
 */
export const GEMMA_E2B_ONNX = {
    id: 'onnx-community/gemma-4-E2B-it-ONNX',
    revision: '9f4bef82ea6e296bc69f8a2f5939f73af81b07a6',
    label: 'Gemma 4 E2B',
    licence: 'Apache 2.0',
    // Every session at the same precision. transformers.js takes this object as its `dtype`,
    // one key per session, which is why it is written as a map and not as one string.
    dtype: {
        embed_tokens: 'q4f16',
        decoder_model_merged: 'q4f16',
        audio_encoder: 'q4f16',
        vision_encoder: 'q4f16'
    },
    files: [
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/config.json', bytes: 5549, sha256: '5494e6677d9e150ea20ba3101ae8a32b0f141004626f052725d8bf48991b9faa' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/generation_config.json', bytes: 238, sha256: 'e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/preprocessor_config.json', bytes: 43, sha256: '4457c6e8a09070d7d5d1cd983fbfb67ebafe602bd98120c3543a024f5d07056b' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/processor_config.json', bytes: 1689, sha256: '32bdf45d2ad4cc29a0822ddd157a182de76644f0419a6228d151495256e9813c' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/chat_template.jinja', bytes: 16317, sha256: '781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/tokenizer.json', bytes: 19439251, sha256: '47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/tokenizer_config.json', bytes: 18807, sha256: '06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/embed_tokens_q4f16.onnx', bytes: 5621, sha256: 'd7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/embed_tokens_q4f16.onnx_data', bytes: 1590689792, sha256: '024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/decoder_model_merged_q4f16.onnx', bytes: 673231, sha256: '73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/decoder_model_merged_q4f16.onnx_data', bytes: 1519700992, sha256: '3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/audio_encoder_q4f16.onnx', bytes: 260446, sha256: '5e0deb22791685c792d4b8e089deef9670fa4a4cecde434213d6a742e58fc3fa' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/audio_encoder_q4f16.onnx_data', bytes: 171258112, sha256: 'df58e61a00bafa9449ee5fd52895ce952f158bbdd1fe38df8a68f48f36842e62' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/vision_encoder_q4f16.onnx', bytes: 189124, sha256: 'e0a4e48e519ade4eeddbb4cdadb812a7251aea871f7fb5f50576615fd3af22a3' },
        { path: 'onnx-community/gemma-4-E2B-it-ONNX/onnx/vision_encoder_q4f16.onnx_data', bytes: 99189440, sha256: '0835071d2c79c105f8e1b549b7f8dd8c9af07fa95f01ead2e7add280602d3c6d' }
    ]
};

/** The two encoder sessions the Light tier never opens. Named once so both readers agree. */
const ENCODER_SESSIONS = ['audio_encoder', 'vision_encoder'];

const withoutEncoders = (files) => files.filter(
    file => !ENCODER_SESSIONS.some(session => file.path.includes(`/${session}_`))
);

/**
 * The same weights, text only — the Light tier's proposer (§5.5).
 *
 * **This is a real saving and not a rounding of one: 3.1 GB against 3.4.** transformers.js
 * decides which sessions to open from the model *class* it is asked for. Loading
 * `Gemma4ForCausalLM` against a repository whose config declares
 * `Gemma4ForConditionalGeneration` puts the library in its `textOnly` mode, where the session
 * map is `embed_tokens` and `decoder_model_merged` and nothing else — so the audio and vision
 * encoders are never opened and never need to be on the device. `web.js` asks for exactly
 * that class on the Light tier, and this record is the download that matches it.
 *
 * The rows are the same rows: a Light-tier device that later detects as Full re-uses every
 * byte it already verified and fetches only the two encoders.
 */
export const GEMMA_E2B_ONNX_TEXT = {
    ...GEMMA_E2B_ONNX,
    dtype: { embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
    files: withoutEncoders(GEMMA_E2B_ONNX.files)
};

/**
 * The same model as one LiteRT-LM bundle — what the Android plugin opens (§5.5 option A).
 *
 * One file rather than four, because LiteRT-LM's format carries the tokeniser, the prompt
 * template and every weight together; the runtime memory-maps the embeddings out of it and
 * loads the audio encoder only when a session is given audio, which is what makes the same
 * 2.6 GB serve both tiers on a phone.
 *
 * The generic CPU/GPU bundle and not one of the six vendor builds beside it in that
 * repository: those are NPU images for one SoC each, and a phone given the wrong one has
 * downloaded 2.6 GB it cannot open.
 */
export const GEMMA_E2B_LITERTLM = {
    id: 'litert-community/gemma-4-E2B-it-litert-lm',
    revision: 'b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1',
    label: 'Gemma 4 E2B',
    licence: 'Apache 2.0',
    // The one file the engine is pointed at. Named here because the plugin needs a path and
    // not a directory, and because a second `.litertlm` in that folder would be ambiguous.
    bundle: 'litert-community/gemma-4-E2B-it-litert-lm/gemma-4-E2B-it.litertlm',
    files: [
        { path: 'litert-community/gemma-4-E2B-it-litert-lm/LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
        { path: 'litert-community/gemma-4-E2B-it-litert-lm/gemma-4-E2B-it.litertlm', bytes: 2588147712, sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c' }
    ]
};

/**
 * The model that proposes feelings, people and triggers — **Gemma 4 E2B, since D3.**
 *
 * One model with three packagings, and the identity is the thing the user is told about: the
 * Vault page names *"Gemma 4 E2B, open weights under the Apache 2.0 licence"* and the
 * provenance block on every model-assisted entry records `model` from here. Which file the
 * device opened is a deployment detail; which model answered is not.
 *
 * `id` is what goes on the row (§6.3). It is the upstream model, not the export, so two
 * devices that ran the same model through different runtimes produce comparable provenance —
 * `runtime` is the field that says which one.
 */
export const PROPOSAL_MODEL = {
    id: 'google/gemma-4-E2B-it',
    label: 'Gemma 4 E2B',
    licence: 'Apache 2.0',
    /** What a browser downloads on each tier, and what a phone downloads on both. */
    web: { full: GEMMA_E2B_ONNX, light: GEMMA_E2B_ONNX_TEXT },
    native: GEMMA_E2B_LITERTLM
};

/** Every model this build knows how to download. */
export const MODELS = {
    whisperTiny: WHISPER_TINY,
    gemmaOnnx: GEMMA_E2B_ONNX,
    gemmaOnnxText: GEMMA_E2B_ONNX_TEXT,
    gemmaLitertLm: GEMMA_E2B_LITERTLM
};

/**
 * Every model a tier needs on this platform, in the order a screen should name them.
 *
 * The Full tier is one model doing one pass over audio (§5.1). The Light tier is two: a
 * transcriber writes the words down and the same Gemma proposes over them in text mode — so
 * a Light-tier device downloads both, and the settings screen says both names and one total.
 * The text-only tier needs nothing, which is why it is an empty list rather than a special
 * case every caller has to remember.
 */
export const tierModels = (tier, { native = false } = {}) => {
    if (tier === 'full') return [native ? GEMMA_E2B_LITERTLM : GEMMA_E2B_ONNX];
    if (tier === 'light') return [WHISPER_TINY, native ? GEMMA_E2B_LITERTLM : GEMMA_E2B_ONNX_TEXT];
    return [];
};

/** The bytes of a whole set, which is what a download line promises. */
export const setBytes = (models) => models.reduce((sum, model) => sum + totalBytes(model), 0);

/**
 * *"Gemma 4 E2B and Whisper tiny"* — the set, named the way a sentence names things.
 *
 * Deduplicated on the label, because the two Gemma records carry the same one: a Light-tier
 * phone downloads one bundle for two jobs and would otherwise be told it was getting the
 * model twice.
 */
export const setLabel = (models) => {
    const labels = [...new Set(models.map(model => model.label))];
    if (labels.length <= 1) return labels[0] ?? '';
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};


/** The full URL a file is fetched from. Relative on purpose: the origin is never named. */
export const modelFileUrl = (file) => `${MODEL_BASE_PATH}${file.path}`;

export const totalBytes = (model) => model.files.reduce((sum, file) => sum + file.bytes, 0);

/**
 * "45 MB", the way a download line should say it.
 *
 * Decimal megabytes, not mebibytes: the number beside a download is a promise about how long
 * a connection will be busy, and every operating system's transfer dialog counts in MB.
 */
export const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} kB`;
    if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
    // One decimal from a gigabyte up. A download this size is a promise about a wait, and
    // "3 GB" for 3,401,460,010 bytes rounds off thirteen per cent of it.
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
};

/** What the settings screen and the download line both say, so they cannot disagree. */
export const modelSize = (model) => formatBytes(totalBytes(model));
