// for (using <pattern> of ...) must be a SyntaxError
const r = {};
for (const src of ["for (using [a] of []) ;", "for (using {a} of []) ;"]) {
    try { new Function(src); r[src] = "accepted"; } catch (e) { r[src] = e.name; }
}
print(JSON.stringify(r), "(expected SyntaxError for both)");
