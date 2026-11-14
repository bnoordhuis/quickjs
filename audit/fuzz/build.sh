#!/bin/sh
# Builds the libFuzzer targets and their seed corpora.
# usage (from the repository root): audit/fuzz/build.sh [OUTDIR]   (default build/fuzz)
# Needs clang. The engine is compiled once and linked into each target.
set -eu
OUT=${1:-build/fuzz}
CC=${CC:-clang}
HERE=$(dirname "$0")
# The function sanitizer stays on unless the source still has the mismatched
#   allocator casts (findings.md N3), which abort on every normalize() call.
# -D__SANITIZE_ADDRESS__=1: clang does not define it, and the engine's small-block
#   arena would otherwise hide use-after-free from ASan (findings.md H1).
NOFUNC=""
grep -q '(DynBufReallocFunc \*)js_realloc' quickjs.c && NOFUNC="-fno-sanitize=function"
FLAGS="-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined $NOFUNC
  -fno-sanitize-recover=undefined -D_GNU_SOURCE -DQUICKJS_NG_BUILD -D__SANITIZE_ADDRESS__=1
  -funsigned-char -I."
mkdir -p "$OUT/obj"
for f in quickjs libregexp libunicode dtoa; do
    $CC $FLAGS -fsanitize=fuzzer-no-link -c "$f.c" -o "$OUT/obj/$f.o" &
done
wait
for f in quickjs libregexp libunicode dtoa; do [ -f "$OUT/obj/$f.o" ] || { echo "failed to compile $f.c"; exit 1; }; done
for t in regexp json number date string; do
    $CC $FLAGS -fsanitize=fuzzer -I"$HERE" "$HERE/fuzz-$t.c" "$OUT"/obj/*.o -lm -lpthread -o "$OUT/fuzz-$t"
    cp "$HERE/fuzz-$t.js" "$OUT/"
    mkdir -p "$OUT/seeds/$t" "$OUT/corpus/$t"
done

seed() { printf "$3" > "$OUT/seeds/$1/$2"; }
# regexp: flags byte, pattern, NUL, subject. Flag bits: d=1 g=2 i=4 m=8 s=16 y=32, u=64, v=128
seed regexp 01 '\000(a+)(b)?c\000xaabcaac'
seed regexp 02 '\003(?<a>\\d+)-(?<b>\\w+)\000tel 123-abc 45-de'
seed regexp 03 '\100\\p{L}+\\u{1F600}?\000hello world'
seed regexp 04 '\200[\\p{L}--[a-f]]+|[\\q{abc|d}]\000xyzabcd'
seed regexp 05 '\004(?<=a(b)?)c|(?<!x)y{2,3}?\000abcyyy'
seed regexp 06 '\012^(\\w)(?:\\1)*$|\\bfoo\\b\000aaa\nfoo bar'
seed regexp 07 '\000(?i:a)b|(?=x)(?!y).\000Abxz'
# json
seed json 01 '{"a":[1,2.5e3,-0,true,false,null],"b":{"c":"\\u00e9\\n"},"a":2}'
seed json 02 '[[],{},"",0,1e-7,123456789012345678901234567890]'
seed json 03 '"\\ud83d\\ude00 \\ud800 x"'
seed json 04 ' -1.5E+10 '
# number: mode byte (even = string, odd = raw double + radix)
seed number 01 '\0001.7976931348623157e308'
seed number 02 '\0000.1'
seed number 03 '\0000x1F'
seed number 04 '\0005e-324'
seed number 05 '\000123456789012345678901234567890.123456789e-5'
seed number 06 '\001\000\000\000\000\000\000\360\077\012'
seed number 07 '\001\232\231\231\231\231\231\271\077\020'
seed number 08 '\001\001\000\000\000\000\000\000\000\002'
# date: mode byte (even = string, odd = doubles)
seed date 01 '\0002026-11-15T12:34:56.789Z'
seed date 02 '\000Sun, 15 Nov 2026 12:34:56 GMT'
seed date 03 '\000Sun Nov 15 2026 12:34:56 GMT+0100 (CET)'
seed date 04 '\000+275760-09-13T00:00:00.000Z'
seed date 05 '\00011/15/2026 1:02 PM PST'
seed date 06 '\001\000\000\000\000\000\250\237\100\000\000\000\000\000\000\044\100\000\000\000\000\000\000\056\100'
# string: a, NUL, b
seed string 01 'hello world hello\000lo'
seed string 02 'e\377\003\001\377\003\047 \377\001\060\000\377\003\001'
seed string 03 '\377\330\075\377\336\000 \377\330\000 x\000 '
seed string 04 '\337\377\001\060I\377\003\243\000SS'
echo "built: $(ls "$OUT" | grep -c '^fuzz-.*[^s]$') files in $OUT"
