(function (t) {
    function chk(c, m) { if (!c) throw "ORACLE json: " + m + " | input " + JSON.stringify(t); }
    var v;
    try { v = JSON.parse(t); } catch (e) {
        chk(e instanceof SyntaxError || e instanceof RangeError || e instanceof InternalError, "JSON.parse threw " + e);
        return;
    }
    // parse -> stringify -> parse -> stringify is stable
    var s1 = JSON.stringify(v);
    var s2 = JSON.stringify(JSON.parse(s1));
    chk(s1 === s2, "round trip changed: " + s1 + " vs " + s2);

    // identity reviver, and source text access for primitives
    var v3 = JSON.parse(t, function (k, val, ctx) {
        if (ctx !== undefined && typeof ctx.source === "string") {
            chk(val === null || typeof val !== "object", "context.source present for a non-primitive");
            chk(Object.is(JSON.parse(ctx.source), val), "context.source " + ctx.source + " does not parse to the value " + String(val));
        }
        return val;
    });
    chk(JSON.stringify(v3) === s1, "identity reviver changed the result");

    // indentation and replacers do not change the data
    chk(JSON.stringify(JSON.parse(JSON.stringify(v, null, 2))) === s1, "indent 2 changed the data");
    chk(JSON.stringify(JSON.parse(JSON.stringify(v, null, "\t \n"))) === s1, "string indent changed the data");
    chk(JSON.stringify(v, function (k, x) { return x; }) === s1, "identity replacer changed the result");
    JSON.stringify(v, ["a", "b", 0, "length"]);

    if (v === null || typeof v !== "object")
        chk(JSON.stringify(JSON.rawJSON(s1)) === s1, "rawJSON round trip");
    chk(JSON.stringify({ k: v, a: [v] }) === '{"k":' + s1 + ',"a":[' + s1 + ']}', "nesting changed the text");
})
