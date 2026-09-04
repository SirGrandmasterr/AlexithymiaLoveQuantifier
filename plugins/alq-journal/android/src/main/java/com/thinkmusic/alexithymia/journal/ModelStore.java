package com.thinkmusic.alexithymia.journal;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The weight store: where the model files live on the device, and the one way they get
 * there — from the configured server, one file at a time, resumed if a previous attempt
 * was cut short, and kept only once the whole file hashes to the sum the app passed in.
 *
 * It is the native half of C3's download manager and follows its rules exactly (§5.6):
 * length is checked before the hash because it is free and because a `/models/` path that
 * fell through to the SPA answers `200` with a page of HTML; a wrong sum deletes what was
 * fetched and reports `checksum`, and there is no way past that outcome; cancel keeps the
 * partial file so the next attempt resumes with a `Range` request rather than starting
 * over. The pins are **not** here — the JavaScript manifest in `models.js` is the one
 * copy, and this class hashes whatever it is told to hash.
 *
 * Files land under the app's private files directory, which `allowBackup="false"` keeps
 * off Google's backup. Nothing here reads the session token, and the only URL it ever
 * opens is `<baseUrl>/models/<path>`.
 *
 * Plain Java on purpose: no Android import, so the JVM harness can drive it against a local
 * server, including the cancel-and-resume and the tampered-file cases.
 */
public final class ModelStore {

    /** One file the caller wants, with what it must be. */
    public static final class FileSpec {
        public final String path;
        public final long bytes;
        public final String sha256;

        public FileSpec(String path, long bytes, String sha256) {
            this.path = path;
            this.bytes = bytes;
            this.sha256 = sha256 == null ? "" : sha256.toLowerCase(Locale.ROOT);
        }
    }

    /** Why a fetch stopped. `kind` is what the JavaScript side branches on. */
    public static final class Failure extends Exception {
        public static final String CHECKSUM = "checksum";
        public static final String LENGTH = "length";
        public static final String NETWORK = "network";
        public static final String STORAGE = "storage";
        public static final String CANCELLED = "cancelled";

        private static final long serialVersionUID = 1L;

        public final String kind;
        public final String path;

        public Failure(String kind, String path, String message) {
            super(message);
            this.kind = kind;
            this.path = path;
        }
    }

    public interface Listener {
        void onProgress(String path, int filesDone, int filesTotal, long loaded, long total);
    }

    private static final String MODELS_PATH = "/models/";
    private static final int BUFFER = 64 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final File root;

    public ModelStore(File root) {
        this.root = root;
    }

    public File root() {
        return root;
    }

    /** Where a manifest path lives. Refuses anything that could leave the root. */
    public File fileFor(String path) throws Failure {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.contains("..") || path.contains("\\")) {
            throw new Failure(Failure.STORAGE, path, "refusing a model path outside the store: " + path);
        }
        return new File(root, path);
    }

    /** Every file present at its declared length. The hash was checked on the way in. */
    public boolean isReady(List<FileSpec> files) {
        try {
            for (FileSpec spec : files) {
                File file = fileFor(spec.path);
                if (!file.isFile() || file.length() != spec.bytes) return false;
            }
            return !files.isEmpty();
        } catch (Failure e) {
            return false;
        }
    }

    public boolean remove(List<FileSpec> files) {
        boolean all = true;
        for (FileSpec spec : files) {
            try {
                File file = fileFor(spec.path);
                File part = partFor(file);
                if (file.exists() && !file.delete()) all = false;
                if (part.exists() && !part.delete()) all = false;
                pruneEmptyParents(file.getParentFile());
            } catch (Failure e) {
                all = false;
            }
        }
        return all;
    }

    /**
     * Fetch every file that is not already present, verifying each before it is kept.
     *
     * @param cancel set by another thread to stop; the partial file is kept for a resume
     */
    public void fetch(String baseUrl, List<FileSpec> files, Listener listener, AtomicBoolean cancel) throws Failure {
        long total = 0;
        for (FileSpec spec : files) total += spec.bytes;
        long loaded = 0;

        for (int index = 0; index < files.size(); index++) {
            FileSpec spec = files.get(index);
            File target = fileFor(spec.path);
            if (listener != null) listener.onProgress(spec.path, index, files.size(), loaded, total);

            if (target.isFile() && target.length() == spec.bytes) {
                loaded += spec.bytes;
                if (listener != null) listener.onProgress(spec.path, index + 1, files.size(), loaded, total);
                continue;
            }

            fetchOne(baseUrl, spec, target, listener, cancel, index, files.size(), loaded, total);
            loaded += spec.bytes;
            if (listener != null) listener.onProgress(spec.path, index + 1, files.size(), loaded, total);
        }
    }

    private void fetchOne(String baseUrl, FileSpec spec, File target, Listener listener, AtomicBoolean cancel,
                          int index, int filesTotal, long loadedBefore, long total) throws Failure {
        File part = partFor(target);
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new Failure(Failure.STORAGE, spec.path, "cannot create " + parent);
        }

        long offset = part.isFile() ? part.length() : 0;
        if (offset >= spec.bytes) {
            // A partial file that is already as long as the whole one is not a resume; it
            // is a leftover from a different pin. Start over.
            delete(part);
            offset = 0;
        }

        String url = modelUrl(baseUrl, spec.path);
        HttpURLConnection connection = null;
        try {
            connection = open(url, offset);
            int status = connection.getResponseCode();
            boolean append;
            if (status == HttpURLConnection.HTTP_PARTIAL && offset > 0) {
                append = true;
            } else if (status == HttpURLConnection.HTTP_OK) {
                // No range support, or nothing to resume: the whole body arrives.
                append = false;
                offset = 0;
            } else if (status == 416 && offset > 0) {
                // The server disagrees about the length; the partial file is not trustworthy.
                connection.disconnect();
                delete(part);
                connection = open(url, 0);
                status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new Failure(Failure.NETWORK, spec.path, url + " answered " + status);
                }
                append = false;
                offset = 0;
            } else {
                throw new Failure(Failure.NETWORK, spec.path, url + " answered " + status);
            }

            long declared = connection.getContentLengthLong();
            if (declared >= 0 && offset + declared != spec.bytes) {
                // Free, and it catches the SPA's index.html standing in for a weight file.
                throw new Failure(Failure.LENGTH, spec.path,
                    spec.path + " is " + (offset + declared) + " bytes on the server, expected " + spec.bytes);
            }

            try (InputStream in = connection.getInputStream();
                 OutputStream out = new FileOutputStream(part, append)) {
                byte[] buffer = new byte[BUFFER];
                long written = offset;
                int read;
                while ((read = in.read(buffer)) > 0) {
                    if (cancel != null && cancel.get()) {
                        throw new Failure(Failure.CANCELLED, spec.path, "cancelled");
                    }
                    out.write(buffer, 0, read);
                    written += read;
                    if (written > spec.bytes) {
                        throw new Failure(Failure.LENGTH, spec.path, spec.path + " is longer than its declared " + spec.bytes + " bytes");
                    }
                    if (listener != null) listener.onProgress(spec.path, index, filesTotal, loadedBefore + written, total);
                }
            }
        } catch (Failure failure) {
            if (Failure.LENGTH.equals(failure.kind)) delete(part);
            throw failure;
        } catch (IOException e) {
            // A dropped connection keeps the partial file: the next attempt resumes it.
            throw new Failure(Failure.NETWORK, spec.path, e.getMessage() == null ? "the download stopped" : e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }

        if (part.length() != spec.bytes) {
            delete(part);
            throw new Failure(Failure.LENGTH, spec.path, spec.path + " is " + part.length() + " bytes, expected " + spec.bytes);
        }

        String actual;
        try {
            actual = sha256(part);
        } catch (IOException | NoSuchAlgorithmException e) {
            delete(part);
            throw new Failure(Failure.STORAGE, spec.path, "could not hash " + spec.path);
        }
        if (!actual.equals(spec.sha256)) {
            // Nothing is kept. This is the branch the whole class exists for.
            delete(part);
            throw new Failure(Failure.CHECKSUM, spec.path, spec.path + " does not match its published checksum");
        }

        if (target.exists() && !target.delete()) {
            throw new Failure(Failure.STORAGE, spec.path, "cannot replace " + target);
        }
        if (!part.renameTo(target)) {
            delete(part);
            throw new Failure(Failure.STORAGE, spec.path, "cannot keep " + target);
        }
    }

    static String modelUrl(String baseUrl, String path) {
        String base = baseUrl == null ? "" : baseUrl.trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + MODELS_PATH + path;
    }

    private static HttpURLConnection open(String url, long offset) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
        return connection;
    }

    private static File partFor(File target) {
        return new File(target.getParentFile(), target.getName() + ".part");
    }

    private static void delete(File file) {
        if (file.exists() && !file.delete()) file.deleteOnExit();
    }

    private void pruneEmptyParents(File directory) {
        while (directory != null && !directory.equals(root)) {
            String[] children = directory.list();
            if (children == null || children.length > 0 || !directory.delete()) return;
            directory = directory.getParentFile();
        }
    }

    public static String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER];
            int read;
            while ((read = in.read(buffer)) > 0) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        return hex.toString();
    }
}
