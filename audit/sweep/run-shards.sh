#!/bin/sh
# Runs one shard of a sweep, split into sub-ranges that run in parallel, and
# writes a Markdown summary to stdout.
#
# usage: audit/sweep/run-shards.sh QJS SWEEP.js OUTDIR SHARD NSHARDS [PARALLEL]
#   SHARD is 0-based. PARALLEL defaults to the CPU count.
# Exit status: 0 if every sub-range completed with no crash, 1 otherwise.
set -u
QJS=$1 SWEEP=$2 OUT=$3 SHARD=$4 NSHARDS=$5
PAR=${6:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}
DIR=$(dirname "$0")
export ASAN_OPTIONS=${ASAN_OPTIONS:-detect_leaks=0}

TOTAL=$("$QJS" --std -C "$SWEEP" 999999999 0 2>&1 | sed -n 's/^cases=\([0-9]*\).*/\1/p')
[ -n "$TOTAL" ] || { echo "cannot count cases in $SWEEP"; exit 1; }
FROM=$((TOTAL * SHARD / NSHARDS))
TO=$((TOTAL * (SHARD + 1) / NSHARDS))
mkdir -p "$OUT"

i=0
while [ "$i" -lt "$PAR" ]; do
    f=$((FROM + (TO - FROM) * i / PAR))
    t=$((FROM + (TO - FROM) * (i + 1) / PAR))
    sh "$DIR/run-sweep.sh" "$QJS" "$SWEEP" "$OUT/part$i" "$f" "$t" > "$OUT/part$i.txt" 2>&1 &
    i=$((i + 1))
done
wait

cat "$OUT"/part*/crashes.tsv > "$OUT/crashes.tsv" 2>/dev/null
complete=$(grep -l '^status: complete' "$OUT"/part*.txt 2>/dev/null | wc -l | tr -d ' ')
crashes=$(wc -l < "$OUT/crashes.tsv" | tr -d ' ')

echo "### $(basename "$SWEEP") shard $SHARD/$NSHARDS: cases $FROM-$TO of $TOTAL"
echo
echo "- sub-ranges complete: $complete of $PAR"
echo "- crashes recorded: $crashes"
if [ "$crashes" -gt 0 ]; then
    echo
    echo '| count | signature | first case |'
    echo '|---|---|---|'
    cut -f2 "$OUT/crashes.tsv" | sort | uniq -c | sort -rn | while read -r n sig; do
        first=$(awk -F'\t' -v s="$sig" '$2 == s { print $1 ": " $3; exit }' "$OUT/crashes.tsv")
        printf '| %s | `%s` | `%s` |\n' "$n" "$sig" "$first"
    done
fi
[ "$crashes" -eq 0 ] && [ "$complete" -eq "$PAR" ]
