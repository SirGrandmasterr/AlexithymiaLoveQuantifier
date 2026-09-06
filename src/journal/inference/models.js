/** Where Nginx serves the volume. The trailing slash is what transformers.js expects. */
export const MODEL_BASE_PATH = '/models/';

/** The Cache Storage bucket. Versioned, so a later format change can leave the old one behind. */
export const MODEL_CACHE_NAME = 'alq:journal-models:v1';

export const WHISPER_TINY = {
    id: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
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

export const GEMMA_E2B_ONNX_TEXT = {
    ...GEMMA_E2B_ONNX,
    dtype: { embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
    files: withoutEncoders(GEMMA_E2B_ONNX.files)
};

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

export const GEMMA_E4B_ONNX = {
    id: 'onnx-community/gemma-4-E4B-it-ONNX',
    revision: '843f250f23bc91754def1e0f0db390dacd1e6b05',
    label: 'Gemma 4 E4B',
    licence: 'Apache 2.0',
    dtype: {
        embed_tokens: 'q4f16',
        decoder_model_merged: 'q4f16',
        audio_encoder: 'q4f16',
        vision_encoder: 'q4f16'
    },
    files: [
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/config.json', bytes: 5741, sha256: '2033bacb60b38bb3d43be4978c64618e7d8abd7f' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/generation_config.json', bytes: 238, sha256: 'b2b0ab11eaf5317ad648bb48ce64b110532d661a' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/preprocessor_config.json', bytes: 43, sha256: '6418e09c5fdb500f7ad9e86a7de9de7e60317f34' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/processor_config.json', bytes: 1689, sha256: '5465974d23e1eca2c46c2809b26c997946ce0d90' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/chat_template.jinja', bytes: 16317, sha256: '07e50e69a8c445f2c31a089b828e85b2a93942bf' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/tokenizer.json', bytes: 19439251, sha256: '47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/tokenizer_config.json', bytes: 18807, sha256: '8dc6453271e40decb8ebdb68f4f9421d306dd6b3' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/embed_tokens_q4f16.onnx', bytes: 5619, sha256: 'aa48aa1806eda0ea42b79cd8eea355aebaf3b6ae3b04190bfee7ceef308603a4' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/embed_tokens_q4f16.onnx_data', bytes: 2017460224, sha256: 'fd0f39c08f7e20a31145c2351a76a408b6c4ab60d15cc33f40e29cf30c0b2451' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/decoder_model_merged_q4f16.onnx', bytes: 850610, sha256: '43aa27452be3dd7fbb9524257dd66af957add748ddab20ea63ae71923e59aa08' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/decoder_model_merged_q4f16.onnx_data', bytes: 2074847232, sha256: 'b6aa13eab3ecdf4721293e93c806c279ca0516956187f7aec63ee90ec7216e73' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/decoder_model_merged_q4f16.onnx_data_1', bytes: 812318720, sha256: '84e1c5f09ba88a5351959e4f73f62bce46f92dc19a7d7c82376ef36771c26a30' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/audio_encoder_q4f16.onnx', bytes: 260446, sha256: 'abf9f3db89b336579c786704e147747085ccca23f28ecdf33f6736a93e3fbc47' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/audio_encoder_q4f16.onnx_data', bytes: 172167424, sha256: '814635b03d618d2513d377e051d491d0a5448f1407864fb2535e4b8182f9eced' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/vision_encoder_q4f16.onnx', bytes: 189126, sha256: '7475ce3d5d98d74003410367cc53f23ddb38891e1847cce0a4535fb6d953c540' },
        { path: 'onnx-community/gemma-4-E4B-it-ONNX/onnx/vision_encoder_q4f16.onnx_data', bytes: 100762304, sha256: '6cada2b035aed2284ef3a379fb6523906b95da1c1a24af7182161342d1269a52' }
    ]
};

export const GEMMA_E4B_ONNX_TEXT = {
    ...GEMMA_E4B_ONNX,
    dtype: { embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
    files: withoutEncoders(GEMMA_E4B_ONNX.files)
};

export const GEMMA_E4B_LITERTLM = {
    id: 'litert-community/gemma-4-E4B-it-litert-lm',
    revision: '2eee7ac325f20eb8c9ac1d0e972f7c84663062da',
    label: 'Gemma 4 E4B',
    licence: 'Apache 2.0',
    bundle: 'litert-community/gemma-4-E4B-it-litert-lm/gemma-4-E4B-it.litertlm',
    files: [
        { path: 'litert-community/gemma-4-E4B-it-litert-lm/LICENSE.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
        { path: 'litert-community/gemma-4-E4B-it-litert-lm/gemma-4-E4B-it.litertlm', bytes: 3659530240, sha256: '0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0' }
    ]
};

/**
 * EmbeddingGemma 300m, ONNX, q4 — the index's model (§5.8, G1).
 *
 * **Not a tier model and not part of any `tierModels` set.** It is its own opt-in, behind
 * its own key, downloaded only when the user turns similar-entry suggestions on: a device
 * that transcribes and proposes has no need of a vector for anything, and a 219 MB download
 * that arrives because a *different* switch was flipped is the kind of surprise §5.6 spends
 * a paragraph avoiding.
 *
 * **q4 rather than q8, and the reason is a sentence in §5.8 rather than a preference.** The
 * design's model paragraph says *"under 200 MB of RAM quantised"*, which is Google's own
 * number for the 4-bit build; `model_quantized` (q8) is 309 MB of weights and would make
 * that sentence false on the page that quotes it. `fp16` is not an option at all — the
 * upstream card says EmbeddingGemma's activations do not support it, which is why §5.8
 * names `q8`/`q4` and stops there.
 *
 * **219 MB, measured 2026-09-04** from this revision, against §5.8's estimated *"~200–300 MB
 * (verify)"* — inside it, and the design document now carries the measurement. `totalBytes()`
 * recomputes it from the rows rather than trusting the label.
 *
 * **`GEMMA_TERMS_OF_USE.txt` is a row here for the same reason Whisper's `LICENSE.txt` is.**
 * EmbeddingGemma is not Apache: it is under the Gemma Terms of Use, whose Section 3.1
 * requires a copy of the terms to accompany any Distribution — and serving these weights
 * from the operator's own machine is Distribution (§5.6). The difference from every other
 * row is where the bytes come from: Google publishes the terms as an HTML page that is not
 * byte-stable (two fetches seconds apart on 2026-09-04 hashed differently), so it cannot be
 * pinned by URL the way a weight file is. The copy lives in `licences/` in this repository,
 * `make models-fetch` installs it into the volume, and `models.test.js` hashes the file and
 * asserts the sum below — which is a stronger rail than a URL pin, not a weaker one.
 */
export const EMBEDDING_GEMMA_ONNX = {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    revision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
    label: 'EmbeddingGemma',
    licence: 'Gemma Terms of Use',
    dtype: 'q4',
    files: [
        { path: 'onnx-community/embeddinggemma-300m-ONNX/GEMMA_TERMS_OF_USE.txt', bytes: 11530, sha256: '099c2f941f08d38100e72772d025fc555abb440f55e17d4f9799d2caf4e36535' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/config.json', bytes: 1765, sha256: '6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/tokenizer.json', bytes: 20323312, sha256: '4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/tokenizer_config.json', bytes: 1156830, sha256: '3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/special_tokens_map.json', bytes: 662, sha256: '2f7b0adf4fb469770bb1490e3e35df87b1dc578246c5e7e6fc76ecf33213a397' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/added_tokens.json', bytes: 35, sha256: '50b2f405ba56a26d4913fd772089992252d7f942123cc0a034d96424221ba946' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/onnx/model_q4.onnx', bytes: 519322, sha256: 'ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043' },
        { path: 'onnx-community/embeddinggemma-300m-ONNX/onnx/model_q4.onnx_data', bytes: 196725760, sha256: '599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02' }
    ]
};

/**
 * The embedding descriptor for the Vault and for the settings screen (§5.8, G1).
 *
 * Identifies the model by its label and its upstream id (`google/embeddinggemma-300m`),
 * records its licence and its native width, and points at `EMBEDDING_GEMMA_ONNX`.
 */
export const EMBEDDING_MODEL = {
    id: 'google/embeddinggemma-300m',
    label: 'EmbeddingGemma',
    licence: 'Gemma Terms of Use',
    /** The full width the model emits, before §5.8's Matryoshka truncation. */
    nativeDims: 768,
    web: EMBEDDING_GEMMA_ONNX
};

/**
 * The model that proposes feelings, people and triggers — **Gemma 4 E4B.**
 *
 * One model with three packagings, and the identity is the thing the user is told about: the
 * Vault page names *"Gemma 4 E4B, open weights under the Apache 2.0 licence"* and the
 * provenance block on every model-assisted entry records `model` from here. Which file the
 * device opened is a deployment detail; which model answered is not.
 *
 * `id` is what goes on the row (§6.3). It is the upstream model, not the export, so two
 * devices that ran the same model through different runtimes produce comparable provenance —
 * `runtime` is the field that says which one.
 */
export const PROPOSAL_MODEL = {
    id: 'google/gemma-4-E4B-it',
    label: 'Gemma 4 E4B',
    licence: 'Apache 2.0',
    /** What a browser downloads on each tier, and what a phone downloads on both. */
    web: { full: GEMMA_E4B_ONNX, light: GEMMA_E4B_ONNX_TEXT },
    native: GEMMA_E4B_LITERTLM
};

/**
 * The model behind the Gemini option (§5.5b) — **the one entry here with no files.**
 *
 * It is in this module because this is where the app keeps *what a model is and what it is
 * called*, and the provenance block on a relayed entry records `model` from here exactly as
 * it does for Gemma. Everything else about it is different, and the shape says so: no
 * `files`, so nothing downloads and `totalBytes` is never asked; no `dtype`, because no
 * session is opened here; and a `terms` rather than a `licence`, because open weights under
 * Apache 2.0 and a hosted API under someone's terms of service are not the same kind of
 * promise, and the settings copy must not imply they are.
 *
 * `id` is the default. The server is the authority — it is the machine holding the key and
 * the model name — so `cloudProposalStatus` overrides it with whatever the operator
 * configured, and that is what lands in provenance.
 */
export const GEMINI_MODEL = {
    id: 'gemini-2.5-flash',
    label: 'Gemini',
    terms: 'Google\'s API terms',
    /** Where the request goes, so the settings screen can name it without hard-coding a host. */
    provider: 'Google'
};

/** Every model this build knows how to download or manage. */
export const MODELS = {
    whisperTiny: WHISPER_TINY,
    gemmaOnnx: GEMMA_E4B_ONNX,
    gemmaOnnxText: GEMMA_E4B_ONNX_TEXT,
    gemmaLitertLm: GEMMA_E4B_LITERTLM,
    gemmaE2bOnnx: GEMMA_E2B_ONNX,
    gemmaE2bLitertLm: GEMMA_E2B_LITERTLM,
    embeddingGemma: EMBEDDING_GEMMA_ONNX
};

export const tierModels = (tier, { native = false } = {}) => {
    if (tier === 'full') return [native ? GEMMA_E4B_LITERTLM : GEMMA_E4B_ONNX];
    if (tier === 'light') return [WHISPER_TINY, native ? GEMMA_E4B_LITERTLM : GEMMA_E4B_ONNX_TEXT];
    return [];
};

/** The bytes of a whole set, which is what a download line promises. */
export const setBytes = (models) => models.reduce((sum, model) => sum + totalBytes(model), 0);

export const setLabel = (models) => {
    const labels = [...new Set(models.map(model => model.label))];
    if (labels.length <= 1) return labels[0] ?? '';
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};

/** The full URL a file is fetched from. Relative on purpose: the origin is never named. */
export const modelFileUrl = (file) => `${MODEL_BASE_PATH}${file.path}`;

export const totalBytes = (model) => model.files.reduce((sum, file) => sum + file.bytes, 0);

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
