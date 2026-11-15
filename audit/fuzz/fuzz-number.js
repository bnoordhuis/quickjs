(function (s, d, radix, c_strtod, c_shortest) {
    function chk(c, m) { if (!c) throw "ORACLE number: " + m; }

    if (s !== undefined) {
        var n = Number(s), pf = parseFloat(s);
        for (var r = 2; r <= 36; r++) {
            var pi = parseInt(s, r);
            chk(Number.isNaN(pi) || Number.isInteger(pi) || !Number.isFinite(pi), "parseInt gave a fraction for " + JSON.stringify(s) + " radix " + r);
        }
        try { BigInt(s); } catch (e) {}
        // Plain decimal literals must agree with the C library, which rounds correctly.
        // Exponents are capped at 5 digits: larger ones hit the known js_atod overflow (#1902-18).
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d{1,5})?$/.test(s)) {
            var ref = c_strtod(s);
            chk(Object.is(pf, ref), "parseFloat(" + JSON.stringify(s) + ") = " + pf + ", strtod = " + ref);
            chk(Object.is(n, ref), "Number(" + JSON.stringify(s) + ") = " + n + ", strtod = " + ref);
            if (!/^[+-]?0\d/.test(s)) {   // not a legacy octal literal
                var lit = (0, eval)(s);
                chk(Object.is(lit, ref), "literal " + s + " = " + lit + ", strtod = " + ref);
            }
        }
        return;
    }

    // === rather than Object.is: -0 prints as "0"
    var str = String(d);
    chk(Number(str) === d || d !== d, "String/Number round trip: " + str);
    chk(parseFloat(str) === d || d !== d, "String/parseFloat round trip: " + str);
    if (!Number.isFinite(d)) {
        d.toFixed(2); d.toExponential(2); d.toPrecision(2); d.toString(radix);
        return;
    }

    // Shortest form: must round-trip and must not use more digits than needed.
    var e = d.toExponential();
    chk(Object.is(Number(e), d) || d === 0, "toExponential() round trip: " + e);
    var ref = c_shortest(d);
    // Powers of two are skipped: some print 17 digits where fewer suffice (findings.md N4).
    var isPow2 = (new BigUint64Array(new Float64Array([d]).buffer)[0] & 0xFFFFFFFFFFFFFn) === 0n;
    if (e !== ref && !isPow2) {
        var digits = function (x) { return x.split("e")[0].replace(/[-.]/g, "").length; };
        chk(digits(e) <= digits(ref), "toExponential() " + e + " is longer than the shortest form " + ref);
        chk(digits(e) < digits(ref), "toExponential() " + e + " differs from the closest shortest form " + ref);
    }

    var ks = [0, 1, 2, 3, 5, 8, 13, 15, 16, 17, 18, 20, 21, 22, 30, 50, 99, 100];
    for (var q = 0; q < ks.length; q++) {
        var k = ks[q];
        var ex = d.toExponential(k);
        if (k >= 16) chk(Number(ex) === d, "toExponential(" + k + ") round trip: " + ex);
        if (k >= 1) {
            var pr = d.toPrecision(k);
            if (k >= 17) chk(Number(pr) === d, "toPrecision(" + k + ") round trip: " + pr);
        }
        var fx = d.toFixed(k);
        if (k === 100 && Math.abs(d) < 1e21 && (d === 0 || Math.abs(d) >= 1e-60))
            chk(Number(fx) === d, "toFixed(100) round trip: " + fx);
    }

    for (var r = 2; r <= 36; r++) {
        var t = d.toString(r);
        if (Number.isInteger(d) && Math.abs(d) <= 2 ** 53)
            chk(parseInt(t, r) === d, "toString(" + r + ")/parseInt round trip: " + t);
    }
    d.toString(radix); d.toLocaleString();
    try { BigInt(d).toString(radix); BigInt.asIntN(64, BigInt(d)); } catch (err) {}
    Math.round(d); Math.fround(d); Math.trunc(d); (d | 0); (d >>> 0); Math.clz32(d);
})
