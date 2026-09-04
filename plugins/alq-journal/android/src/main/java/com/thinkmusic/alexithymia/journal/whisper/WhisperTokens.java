package com.thinkmusic.alexithymia.journal.whisper;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class WhisperTokens {

    public final int startOfTranscript;
    public final int endOfText;
    public final int noTimestamps;
    public final int transcribeTask;
    public final int maxLength;
    public final int[] suppress;
    public final int[] beginSuppress;

    private final String[] idToToken;
    private final Map<String, Integer> languageToId = new HashMap<>();
    private final Map<Integer, String> idToLanguage = new HashMap<>();
    private final int[] sortedLanguageIds;
    private final int[] byteOfCodePoint = new int[512];

    private WhisperTokens(JSONObject vocab, JSONObject generation) throws JSONException {
        startOfTranscript = generation.getInt("decoder_start_token_id");
        endOfText = generation.getInt("eos_token_id");
        noTimestamps = generation.getInt("no_timestamps_token_id");
        transcribeTask = generation.getJSONObject("task_to_id").getInt("transcribe");
        maxLength = generation.optInt("max_length", 448);
        suppress = toIntArray(generation.optJSONArray("suppress_tokens"));
        beginSuppress = toIntArray(generation.optJSONArray("begin_suppress_tokens"));

        JSONObject languages = generation.getJSONObject("lang_to_id");
        List<Integer> ids = new ArrayList<>();
        for (Iterator<String> it = languages.keys(); it.hasNext();) {
            String token = it.next();            // "<|en|>"
            int id = languages.getInt(token);
            String code = token.substring(2, token.length() - 2);
            languageToId.put(code, id);
            idToLanguage.put(id, code);
            ids.add(id);
        }
        sortedLanguageIds = new int[ids.size()];
        for (int i = 0; i < ids.size(); i++) sortedLanguageIds[i] = ids.get(i);
        java.util.Arrays.sort(sortedLanguageIds);

        int size = 0;
        for (Iterator<String> it = vocab.keys(); it.hasNext();) size = Math.max(size, vocab.getInt(it.next()) + 1);
        idToToken = new String[size];
        for (Iterator<String> it = vocab.keys(); it.hasNext();) {
            String token = it.next();
            idToToken[vocab.getInt(token)] = token;
        }

        buildByteDecoder();
    }

    public static WhisperTokens load(File vocabJson, File generationConfigJson) throws IOException {
        try {
            JSONObject vocab = new JSONObject(new String(Files.readAllBytes(vocabJson.toPath()), StandardCharsets.UTF_8));
            JSONObject generation = new JSONObject(new String(Files.readAllBytes(generationConfigJson.toPath()), StandardCharsets.UTF_8));
            return new WhisperTokens(vocab, generation);
        } catch (JSONException e) {
            throw new IOException("unreadable tokenizer files: " + e.getMessage(), e);
        }
    }

    private static int[] toIntArray(JSONArray array) throws JSONException {
        if (array == null) return new int[0];
        int[] out = new int[array.length()];
        for (int i = 0; i < out.length; i++) out[i] = array.getInt(i);
        return out;
    }

    private void buildByteDecoder() {
        java.util.Arrays.fill(byteOfCodePoint, -1);
        boolean[] printable = new boolean[256];
        for (int b = '!'; b <= '~'; b++) printable[b] = true;
        for (int b = 0xA1; b <= 0xAC; b++) printable[b] = true;
        for (int b = 0xAE; b <= 0xFF; b++) printable[b] = true;
        int next = 256;
        for (int b = 0; b < 256; b++) {
            if (printable[b]) byteOfCodePoint[b] = b;
            else byteOfCodePoint[next++] = b;
        }
    }

    /** Every language token id, ascending — the set language detection chooses from. */
    public int[] languageIds() {
        return sortedLanguageIds.clone();
    }

    /** The two-letter code for a language token id, or `null`. */
    public String languageCode(int id) {
        return idToLanguage.get(id);
    }

    /** The token id for a two-letter code, or -1 when the model has no such language. */
    public int languageId(String code) {
        if (code == null) return -1;
        Integer id = languageToId.get(code.toLowerCase(java.util.Locale.ROOT));
        return id == null ? -1 : id;
    }

    public int vocabularySize() {
        return idToToken.length;
    }

    /** The words. Special tokens are skipped; unknown ids are skipped rather than rendered. */
    public String decode(int[] ids, int count) {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        for (int i = 0; i < count; i++) {
            int id = ids[i];
            if (id < 0 || id >= endOfText || id >= idToToken.length) continue;
            String token = idToToken[id];
            if (token == null) continue;
            for (int at = 0; at < token.length();) {
                int cp = token.codePointAt(at);
                at += Character.charCount(cp);
                int b = cp < byteOfCodePoint.length ? byteOfCodePoint[cp] : -1;
                if (b >= 0) bytes.write(b);
            }
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
