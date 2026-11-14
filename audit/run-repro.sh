#!/bin/sh
# Runs every reproducer in audit/repro/manifest.tsv and reports how each ended.
#
# usage: audit/run-repro.sh QJS [HARNESS] [TLA] [OUTDIR]
#   QJS      path to the qjs binary under test
#   HARNESS  path to the interrupt harness (repro/harness/harness.c); "" to skip
#   TLA      path to the TLA teardown harness (repro/harness/tla-teardown.c); "" to skip
#   OUTDIR   where per-test logs and results.tsv go (default: audit-out)
#   JOBS     environment variable: tests run in parallel (default: CPU count)
#
# Report-only: always exits 0. Statuses: PASS (exit 0), FAIL (nonzero exit),
# CRASH (sanitizer report, assertion, or fatal signal), LEAK (LeakSanitizer
# report only), TIMEOUT, SKIP.
set -u

abspath() { case "$1" in /*|"") echo "$1" ;; *) echo "$PWD/$1" ;; esac; }

QJS=$(abspath "${1:?qjs path required}")
HARNESS=$(abspath "${2:-}")
TLA=$(abspath "${3:-}")
OUT=$(abspath "${4:-audit-out}")
REPRO=$(cd "$(dirname "$0")/repro" && pwd)
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}
export QJS HARNESS TLA

mkdir -p "$OUT/logs" "$OUT/rows"
rm -f "$OUT"/rows/*

if command -v python3 >/dev/null 2>&1; then
    (cd "$REPRO" && python3 -I gen-i1865.py)
fi

if command -v timeout >/dev/null 2>&1; then
    TIMEOUT="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT="gtimeout"
else
    TIMEOUT="perl -e 'alarm shift; exec @ARGV'"
fi

# run_one NAME SECS CMD: writes logs/NAME.log and rows/NAME (one TSV line)
run_one() {
    name=$1 secs=$2 cmd=$3
    log="$OUT/logs/$name.log"
    row="$OUT/rows/$name"
    case "$cmd" in
        *'$HARNESS'*) [ -n "$HARNESS" ] || { printf '%s\tSKIP\t-\t-\tno interrupt harness\n' "$name" > "$row"; return; } ;;
        *'$TLA'*) [ -n "$TLA" ] || { printf '%s\tSKIP\t-\t-\tno teardown harness\n' "$name" > "$row"; return; } ;;
    esac
    if [ "$name" = i1865 ] && [ ! -f "$REPRO/i1865.js" ]; then
        printf '%s\tSKIP\t-\t-\tno python3 to generate i1865.js\n' "$name" > "$row"; return
    fi
    start=$(date +%s)
    (cd "$REPRO" && eval "$TIMEOUT \"\$secs\" sh -c \"\$cmd\"") > "$log" 2>&1
    rc=$?
    took=$(( $(date +%s) - start ))
    sig=$(grep -m1 -E 'ERROR: AddressSanitizer|runtime error:|Assertion .* failed|Error: |^[A-Za-z]*Error|^(completed|exception)' "$log" \
          | sed -E 's/==[0-9]+==//; s/ on (unknown )?address 0x[0-9a-f]+.*//; s/ at pc 0x.*//; s#^/[^ ]*/##' | cut -c1-140)
    frame=$(grep -m1 -E '#0 0x' "$log" | sed -nE 's/.* in ([A-Za-z_0-9]+) .*\/([A-Za-z0-9_.-]+:[0-9]+).*/\1 \2/p')
    [ -n "$frame" ] && sig="$sig @ $frame"
    [ -n "$sig" ] || sig=$(grep -v '^\s*$' "$log" | tail -n 1 | cut -c1-140)
    if [ $rc -eq 124 ] || [ $rc -eq 142 ]; then
        status=TIMEOUT
    elif grep -q -E 'ERROR: AddressSanitizer|runtime error:|Assertion .* failed' "$log" || [ $rc -gt 128 ]; then
        status=CRASH
    elif grep -q -E 'ERROR: LeakSanitizer' "$log"; then
        status=LEAK
        sig=$(grep -m1 -E 'SUMMARY: AddressSanitizer: .* leaked' "$log" | sed -E 's/SUMMARY: AddressSanitizer: //')
    elif [ $rc -eq 0 ]; then
        status=PASS
    else
        status=FAIL
    fi
    printf '%s\t%s\t%s\t%ss\t%s\n' "$name" "$status" "$rc" "$took" "$sig" | tr -d '\r' > "$row"
}

TAB=$(printf '\t')
n=0
grep -v -E '^(#|$)' "$REPRO/manifest.tsv" > "$OUT/manifest.tmp"
while IFS="$TAB" read -r name secs cmd; do
    run_one "$name" "$secs" "$cmd" &
    n=$((n + 1))
    if [ "$n" -ge "$JOBS" ]; then
        wait
        n=0
    fi
done < "$OUT/manifest.tmp"
wait
rm -f "$OUT/manifest.tmp"

cat "$OUT"/rows/* | sort > "$OUT/results.tsv"
printf '| test | status | exit | time | signature |\n|---|---|---|---|---|\n'
sed -E 's/\|/\\|/g; s/`/'"'"'/g' "$OUT/results.tsv" | awk -F'\t' '{ printf "| %s | %s | %s | %s | `%s` |\n", $1, $2, $3, $4, $5 }'
exit 0
