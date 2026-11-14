#!/bin/sh
# Runs one fuzz target for a fixed time on all cores, then minimizes the corpus
# and writes a Markdown summary of what it found to stdout.
#
# usage (from the repository root): audit/fuzz/run-fuzz.sh TARGET SECONDS [BUILD_DIR]
#   TARGET is regexp, json, number, date or string. BUILD_DIR defaults to build/fuzz.
# Input:  BUILD_DIR/corpus/TARGET (optional, from an earlier run), BUILD_DIR/seeds/TARGET
# Output: BUILD_DIR/corpus-min/TARGET, BUILD_DIR/crashes/TARGET, BUILD_DIR/fuzz-TARGET.log
# Exit status: 1 if any crashing input was saved, else 0.
set -u
T=$1 SECS=$2 B=${3:-build/fuzz}
HERE=$(dirname "$0")
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}
mkdir -p "$B/corpus/$T" "$B/crashes/$T" "$B/corpus-min/$T"
DICT=""
[ -f "$HERE/dict/$T.dict" ] && DICT="-dict=$HERE/dict/$T.dict"

"$B/fuzz-$T" -fork="$JOBS" -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 \
    -max_total_time="$SECS" -max_len=512 -timeout=30 -rss_limit_mb=2048 \
    -artifact_prefix="$B/crashes/$T/" $DICT "$B/corpus/$T" "$B/seeds/$T" > "$B/fuzz-$T.log" 2>&1
rc=$?
"$B/fuzz-$T" -merge=1 "$B/corpus-min/$T" "$B/corpus/$T" "$B/seeds/$T" > "$B/merge-$T.log" 2>&1

count() { ls "$B/crashes/$T" 2>/dev/null | grep -c "^$1-" ; }
crashes=$(count crash) timeouts=$(count timeout) ooms=$(count oom) leaks=$(count leak)
echo "### fuzz-$T: ${SECS}s on $JOBS cores (exit $rc)"
echo
echo "- last status: \`$(grep -E '^#[0-9]+' "$B/fuzz-$T.log" | tail -n 1 | cut -c1-120)\`"
echo "- corpus: $(ls "$B/corpus-min/$T" | wc -l | tr -d ' ') inputs after minimization"
echo "- saved inputs: $crashes crash, $timeouts timeout, $ooms out-of-memory, $leaks leak"
if [ $((crashes + leaks)) -gt 0 ]; then
    echo
    echo '| count | signature | example input |'
    echo '|---|---|---|'
    for f in "$B/crashes/$T"/crash-* "$B/crashes/$T"/leak-*; do
        [ -f "$f" ] || continue
        out=$("$B/fuzz-$T" "$f" 2>&1)
        sig=$(printf '%s\n' "$out" | grep -m1 -E '^ORACLE|ERROR: AddressSanitizer|runtime error:|Assertion .* failed|ERROR: LeakSanitizer' \
              | sed -E 's/==[0-9]+==//; s/ on (unknown )?address 0x[0-9a-f]+.*//; s#^/[^ ]*/##; s/ \| .*//' | cut -c1-140)
        frame=$(printf '%s\n' "$out" | grep -E '^\s+#[0-9]+ 0x' | grep -v -E 'sanitizer|interceptor|libc\.so|asan_|fuzzer' | head -n 1 \
                | sed -nE 's/.* in ([A-Za-z_0-9]+) .*\/([A-Za-z0-9_.-]+:[0-9]+).*/\1 \2/p')
        [ -n "$sig" ] || sig="does not reproduce from this input alone (try FZ_FRESH=1, or an earlier input corrupted the runtime)"
        case "$sig" in ORACLE*|does*) ;; *) sig="$sig @ $frame" ;; esac
        printf '%s\t%s\n' "$sig" "$(basename "$f")"
    done | sort | awk -F'\t' '{ n[$1]++; if (!($1 in ex)) ex[$1] = $2 } END { for (s in n) printf "| %d | `%s` | `%s` |\n", n[s], s, ex[s] }'
fi
[ "$crashes" -eq 0 ] && [ "$leaks" -eq 0 ]
