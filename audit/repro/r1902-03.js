// for (await using ...) must be a SyntaxError outside async functions
for (const src of [
    "class C { static { for (await using x of []) {} } }",
]) {
    let r;
    try { (0, eval)(src); r = "accepted"; } catch (e) { r = e.name; }
    print(src, "=>", r);
}
