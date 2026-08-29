#!/bin/sh
#
# Fetch and verify on-device model weights into the models_data volume.
#
# Run by `make models-fetch`, inside a one-off Alpine container with the volume mounted at
# /models. It is not meant to be run on a host directly: the Makefile owns the pins, this
# file owns the mechanism, and the split is deliberate — a later session adding Gemma 4 or
# EmbeddingGemma edits a table of URLs and sums and never touches this logic.
#
# Environment:
#   MANIFEST  whitespace-separated rows of  set|path|url|sha256
#   MODELS    whitespace-separated set names to fetch
#   DEST      where the volume is mounted (default /models)
#
# Exit status is 0 only if every selected file is present and hashes to its pinned sum.

set -eu

DEST="${DEST:-/models}"

: "${MANIFEST:?MANIFEST is empty — the Makefile should have passed the pinned rows}"
: "${MODELS:?MODELS is empty — nothing was selected}"

# curl rather than busybox wget: --retry, and an exit status that distinguishes an HTTP 404
# from a transport failure. Hugging Face answers a weight URL with a 307 to a CDN, so the
# redirect following in -L is not optional either.
if ! command -v curl >/dev/null 2>&1; then
    echo "==> installing curl"
    apk add --no-cache curl >/dev/null
fi

# ---------------------------------------------------------------------------
# Refuse a selection the manifest does not describe, before downloading anything.
#
# Without this, `make models-fetch MODELS=gemma-4` — a plausible typo for a set that a later
# session will really add — succeeds, downloads nothing, and reports success. A fetch target
# that can silently do nothing is worse than one that fails.
# ---------------------------------------------------------------------------
known=""
for row in $MANIFEST; do
    name="${row%%|*}"
    case " $known " in
        *" $name "*) ;;
        *) known="$known $name" ;;
    esac
done

for want in $MODELS; do
    case " $known " in
        *" $want "*) ;;
        *)
            echo "ERROR: no such model set: $want" >&2
            echo "       the manifest in the Makefile describes:$known" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Fetch and verify, one row at a time.
# ---------------------------------------------------------------------------
files=0
bytes=0
cached=0

for row in $MANIFEST; do
    set_name="${row%%|*}";  rest="${row#*|}"
    rel="${rest%%|*}";      rest="${rest#*|}"
    url="${rest%%|*}"
    sum="${rest##*|}"

    case " $MODELS " in
        *" $set_name "*) ;;
        *) continue ;;
    esac

    # A pin that is not a sha256 is a placeholder somebody meant to come back to. Catch it
    # here rather than after a multi-gigabyte download.
    case "$sum" in
        [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
        *)
            echo "ERROR: $set_name/$rel has no usable SHA-256 pin: '$sum'" >&2
            exit 1
            ;;
    esac
    if [ "${#sum}" -ne 64 ]; then
        echo "ERROR: $set_name/$rel has a ${#sum}-character pin; a SHA-256 is 64" >&2
        exit 1
    fi

    # The manifest is a trusted file in the repository, but it writes to a mounted volume,
    # so a row that escapes the destination is worth one line to rule out.
    case "$rel" in
        /*|*..*)
            echo "ERROR: refusing a manifest path that is absolute or contains '..': $rel" >&2
            exit 1
            ;;
    esac

    dest="$DEST/$rel"

    if [ -f "$dest" ]; then
        actual="$(sha256sum "$dest" | cut -d' ' -f1)"
        if [ "$actual" = "$sum" ]; then
            size="$(wc -c < "$dest")"
            echo "ok       $rel  (cached, $size bytes)"
            files=$((files + 1))
            bytes=$((bytes + size))
            cached=$((cached + 1))
            continue
        fi

        # Refuse; do not silently re-download.
        #
        # A file already in the volume that does not match its pin is either corruption or
        # tampering, and overwriting it would erase the only evidence of which. The operator
        # decides. This is the path `make models-fetch` is verified against by corrupting a
        # byte — see docs/09-deployment.md §2.
        echo "" >&2
        echo "ERROR: checksum mismatch on a file already in the volume" >&2
        echo "  file      $dest" >&2
        echo "  expected  $sum" >&2
        echo "  actual    $actual" >&2
        echo "" >&2
        echo "  This file was not written by this run. It is corrupt, or it was replaced." >&2
        echo "  Nothing has been overwritten. Delete it and re-run to fetch it again:" >&2
        # The path is kept inside `sh -c` rather than passed as its own argument, and `rm`
        # runs without -f. Both matter on Windows: Git Bash rewrites any argument beginning
        # with a slash into a Windows path before docker.exe sees it, so the obvious form of
        # this line — `docker run ... rm -f /models/$rel` — deletes nothing at all, and -f
        # then makes that success. Verified on 2026-08-25 by watching it not happen.
        echo "    docker run --rm -v love-metrics-models:/models alpine:3.20 sh -c 'rm \"/models/$rel\"'" >&2
        exit 1
    fi

    mkdir -p "$(dirname "$dest")"

    echo "fetch    $rel"
    if ! curl -fL --retry 3 --retry-delay 2 --max-time 3600 \
              --progress-bar -o "$dest.part" "$url"; then
        rm -f "$dest.part"
        rmdir -p "$(dirname "$dest")" 2>/dev/null || true
        echo "ERROR: download failed: $url" >&2
        exit 1
    fi

    actual="$(sha256sum "$dest.part" | cut -d' ' -f1)"
    if [ "$actual" != "$sum" ]; then
        # The .part goes, and so does the directory it was going to live in if this row was
        # the only thing in it — a failed run should leave the volume as it found it, not a
        # tree of empty directories that make `find /models` misreport what is installed.
        rm -f "$dest.part"
        rmdir -p "$(dirname "$dest")" 2>/dev/null || true
        echo "" >&2
        echo "ERROR: checksum mismatch on a freshly downloaded file" >&2
        echo "  url       $url" >&2
        echo "  expected  $sum" >&2
        echo "  actual    $actual" >&2
        echo "" >&2
        echo "  The partial download has been deleted. Either the pin in the Makefile is" >&2
        echo "  wrong, or what that URL serves is not what it served when it was pinned." >&2
        echo "  Do not update the pin without finding out which." >&2
        exit 1
    fi

    # Only now does the file get its real name: an interrupted run leaves a .part, never a
    # short file that the next run would accept as cached.
    mv "$dest.part" "$dest"
    size="$(wc -c < "$dest")"
    echo "verified $rel  ($size bytes)"
    files=$((files + 1))
    bytes=$((bytes + size))
done

if [ "$files" -eq 0 ]; then
    echo "ERROR: the manifest described no files for:$(printf ' %s' $MODELS)" >&2
    exit 1
fi

echo ""
echo "$files file(s), $bytes bytes, all verified against their pinned SHA-256 ($cached already present)."
