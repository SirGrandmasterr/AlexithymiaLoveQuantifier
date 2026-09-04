#!/bin/sh
#
# Turn whatever came off a phone into the clips `make journal-eval` can read, and — optionally
# — derive the noisy half of the suite from the clean half.
#
#   sh scripts/journal-eval/prepare-audio.sh                  convert to 16 kHz mono WAV
#   sh scripts/journal-eval/prepare-audio.sh --noise           also derive *.noisy.wav
#   sh scripts/journal-eval/prepare-audio.sh --noise --snr 5   at a different SNR
#   sh scripts/journal-eval/prepare-audio.sh --dry-run         say what it would do
#
# Needs ffmpeg on PATH and nothing else. It never deletes anything: a converted file is
# written beside its source, and an existing target is left alone unless --force.
#
# Two things this script is deliberately careful about.
#
#   **The noisy condition is evidence, and derived noise is weaker evidence than a room.**
#   A bed mixed in at a stated SNR is reproducible, which is worth a great deal, but it is
#   stationary and a café is not. Prefer a real second take where you can get one; where you
#   cannot, this is honest as long as the report says which clips were which — which is why
#   every derived clip gets a `.noise.txt` sidecar naming the recipe and the seed, and why
#   `make journal-audio-check` reads it into the lock file.
#
#   **It refuses a speaker directory with no consent row**, the same as everything else that
#   touches these files (golden/consent/README.md).

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
AUDIO="$ROOT/src/journal/inference/golden/audio"
SPEAKERS="$ROOT/src/journal/inference/golden/consent/speakers.json"

SNR=10
SEED=1
NOISE=0
FORCE=0
DRY=0

while [ $# -gt 0 ]; do
	case "$1" in
		--noise) NOISE=1 ;;
		--snr) SNR="$2"; shift ;;
		--seed) SEED="$2"; shift ;;
		--force) FORCE=1 ;;
		--dry-run) DRY=1 ;;
		-h|--help)
			sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		*) echo "unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

command -v ffmpeg >/dev/null 2>&1 || {
	echo "ffmpeg is not on PATH. It is the only thing this script needs." >&2
	exit 1
}
[ -d "$AUDIO" ] || { echo "no $AUDIO" >&2; exit 1; }

run() {
	if [ "$DRY" -eq 1 ]; then
		echo "would: $*"
	else
		"$@"
	fi
}

# The consented speaker ids, straight out of the register. `grep`/`sed` rather than a JSON
# parser because this is a POSIX shell script and the field is one line; a speaker whose row
# is malformed simply does not appear, and `make journal-audio-check` is what explains why.
# The `_example` row in that file has an `id` too, which is why the extraction runs from the
# `"speakers"` key onwards and not over the whole document.
consented() {
	tr -d '\r' < "$SPEAKERS" \
		| tr -d '\n' \
		| sed 's/.*"speakers"[[:space:]]*:[[:space:]]*\[//' \
		| tr ',' '\n' \
		| grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' \
		| sed 's/.*"\([^"]*\)"$/\1/'
}

converted=0
derived=0
skipped=0

for dir in "$AUDIO"/*/; do
	[ -d "$dir" ] || continue
	speaker=$(basename "$dir")

	if ! consented | grep -qx "$speaker"; then
		echo "refused  $speaker/ — no row in consent/speakers.json"
		skipped=$((skipped + 1))
		continue
	fi

	# 1. Anything that is not already a canonical WAV becomes one.
	#
	#    -ac 1 -ar 16000 -c:a pcm_s16le is the format golden/recordings.json states, and it is
	#    what both transcribers want. -map_metadata -1 drops the phone's tags, which can carry
	#    a device name and a location: this suite is about voices, not about where they were.
	for source in "$dir"*.m4a "$dir"*.mp3 "$dir"*.ogg "$dir"*.opus "$dir"*.flac "$dir"*.wav; do
		[ -e "$source" ] || continue
		stem=${source%.*}
		target="$stem.wav"

		if [ "$source" = "$target" ]; then
			# Already a WAV: convert in place only if it is the wrong shape.
			shape=$(ffprobe -v error -select_streams a:0 \
				-show_entries stream=sample_rate,channels,codec_name \
				-of csv=p=0 "$source" 2>/dev/null || echo "")
			[ "$shape" = "pcm_s16le,16000,1" ] && continue
			[ "$DRY" -eq 1 ] && { echo "would: normalise $source ($shape)"; converted=$((converted + 1)); continue; }
			run ffmpeg -v error -y -i "$source" -map_metadata -1 -ac 1 -ar 16000 -c:a pcm_s16le "$stem.tmp.wav"
			run mv "$stem.tmp.wav" "$target"
			converted=$((converted + 1))
			continue
		fi

		if [ -e "$target" ] && [ "$FORCE" -eq 0 ]; then continue; fi
		run ffmpeg -v error -y -i "$source" -map_metadata -1 -ac 1 -ar 16000 -c:a pcm_s16le "$target"
		converted=$((converted + 1))
	done

	# 2. The noisy half, derived from the clean take.
	#
	#    A pink-noise bed rather than white: it is closer to a room, a tram and a café than a
	#    flat spectrum, and it does not simply bury the consonants. The bed's level is set from
	#    the clip's own mean volume so the stated SNR means the same thing on a loud clip and a
	#    quiet one, and the seed makes the whole thing reproducible from the sidecar.
	[ "$NOISE" -eq 1 ] || continue
	for clean in "$dir"*.clean.wav; do
		[ -e "$clean" ] || continue
		noisy=$(echo "$clean" | sed 's/\.clean\.wav$/.noisy.wav/')
		if [ -e "$noisy" ] && [ "$FORCE" -eq 0 ]; then continue; fi

		mean=$(ffmpeg -v error -i "$clean" -af volumedetect -f null - 2>&1 \
			| grep -o 'mean_volume: -\{0,1\}[0-9.]*' | head -1 | sed 's/mean_volume: //')
		[ -n "$mean" ] || mean=-20
		# Noise sits SNR dB below the speech. `awk` because POSIX sh has no floating point.
		level=$(awk -v m="$mean" -v s="$SNR" 'BEGIN { printf "%.2f", m - s }')

		if [ "$DRY" -eq 1 ]; then
			echo "would: derive $(basename "$noisy") at ${SNR} dB SNR (bed ${level} dBFS, seed $SEED)"
			derived=$((derived + 1))
			continue
		fi

		duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clean")
		ffmpeg -v error -y -i "$clean" \
			-f lavfi -i "anoisesrc=color=pink:seed=$SEED:sample_rate=16000:duration=$duration" \
			-filter_complex "[1:a]volume=${level}dB[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0" \
			-ac 1 -ar 16000 -c:a pcm_s16le "$noisy"

		{
			echo "derived from $(basename "$clean")"
			echo "recipe   anoisesrc=color=pink:seed=$SEED, bed at ${level} dBFS"
			echo "snr_db   $SNR"
			echo "seed     $SEED"
			echo "ffmpeg   $(ffmpeg -version 2>/dev/null | head -1)"
			echo "note     A stationary pink bed is not a café. Prefer a second real take where you can."
		} > "$(echo "$noisy" | sed 's/\.wav$/.noise.txt/')"
		derived=$((derived + 1))
	done
done

echo
echo "converted $converted, derived $derived, refused $skipped"
echo "next: make journal-audio-check"
