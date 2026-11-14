#!/bin/sh
# Drives a sweep script (ta-sweep.js, array-sweep.js): runs it, and whenever the
# process dies, records which case was running and the sanitizer signature,
# then resumes at the next case.
#
# usage: audit/sweep/run-sweep.sh QJS SWEEP.js OUTDIR [FROM [TO [MAXCRASHES]]]
# FROM/TO select a range of case indices (TO exclusive), for running shards in parallel.
# Output: OUTDIR/crashes.tsv (index, signature, description), OUTDIR/crash-<index>.log
set -u
QJS=$1 SWEEP=$2 OUT=$3 FROM=${4:-0} TO=${5:-999999999} MAX=${6:-200}
mkdir -p "$OUT"
: > "$OUT/crashes.tsv"
export ASAN_OPTIONS=${ASAN_OPTIONS:-detect_leaks=0}
export UBSAN_OPTIONS=${UBSAN_OPTIONS:-print_stacktrace=1:halt_on_error=1}
start=$FROM n=0 status=incomplete
while [ "$n" -lt "$MAX" ] && [ "$start" -lt "$TO" ]; do
    "$QJS" --std -C "$SWEEP" "$start" "$((TO - start))" > "$OUT/run.out" 2> "$OUT/run.err"
    rc=$?
    if grep -q '^cases=' "$OUT/run.err"; then
        tail -n 1 "$OUT/run.err"
        status=complete
        break
    fi
    last=$(tail -n 1 "$OUT/run.out")
    case "$last" in ''|*[!0-9]*) echo "cannot attribute failure (rc=$rc, last='$last')"; cat "$OUT/run.err" | head -20; break ;; esac
    desc=$("$QJS" --std -C "$SWEEP" "$last" 1 v 2> "$OUT/crash-$last.log" | head -n 1 | cut -d' ' -f2-)
    sig=$(grep -m1 -E 'ERROR: AddressSanitizer|runtime error:|Assertion .* failed' "$OUT/crash-$last.log" \
          | sed -E 's/==[0-9]+==//; s/ on (unknown )?address 0x[0-9a-f]+.*//; s#^/[^ ]*/##' | cut -c1-120)
    frames=$(grep -E '^\s+#[0-9]+ 0x' "$OUT/crash-$last.log" | grep -v -E 'sanitizer|interceptor|libc\.so|asan_' | head -n 3 \
             | sed -nE 's/.* in ([A-Za-z_0-9]+) .*\/([A-Za-z0-9_.-]+:[0-9]+).*/\1 \2/p' | tr '\n' ';')
    [ -n "$sig" ] || sig="rc=$rc $(tail -n 1 "$OUT/run.err" | cut -c1-100)"
    printf '%s\t%s @ %s\t%s\n' "$last" "$sig" "$frames" "$desc" >> "$OUT/crashes.tsv"
    n=$((n + 1))
    start=$((last + 1))
    [ "$start" -ge "$TO" ] && status=complete
done
echo "status: $status"
echo "crashes recorded: $n"
cut -f2 "$OUT/crashes.tsv" | sort | uniq -c | sort -rn
