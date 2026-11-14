(function (a, b) {
    function chk(c, m) { if (!c) throw "ORACLE string: " + m + " | a=" + JSON.stringify(a) + " b=" + JSON.stringify(b); }

    // Normalization identities
    var n = {};
    ["NFC", "NFD", "NFKC", "NFKD"].forEach(function (f) {
        n[f] = a.normalize(f);
        chk(n[f].normalize(f) === n[f], f + " is not idempotent");
    });
    chk(n.NFD.normalize("NFC") === n.NFC, "NFC(NFD(a)) != NFC(a)");
    chk(n.NFC.normalize("NFD") === n.NFD, "NFD(NFC(a)) != NFD(a)");
    chk(n.NFKD.normalize("NFKC") === n.NFKC, "NFKC(NFKD(a)) != NFKC(a)");
    chk(n.NFKC.normalize("NFKD") === n.NFKD, "NFKD(NFKC(a)) != NFKD(a)");
    chk(n.NFC.normalize("NFKC") === n.NFKC, "NFKC(NFC(a)) != NFKC(a)");
    chk(n.NFD.normalize("NFKD") === n.NFKD, "NFKD(NFD(a)) != NFKD(a)");

    // Case mapping
    var lo = a.toLowerCase(), up = a.toUpperCase();
    chk(lo.toLowerCase() === lo, "toLowerCase is not idempotent");
    chk(up.toUpperCase() === up, "toUpperCase is not idempotent");
    a.toLocaleLowerCase(); a.toLocaleUpperCase();

    // Comparison
    var c1 = a.localeCompare(b), c2 = b.localeCompare(a);
    chk((c1 > 0) === (c2 < 0) && (c1 < 0) === (c2 > 0), "localeCompare is not antisymmetric: " + c1 + " " + c2);
    chk(a.localeCompare(a) === 0, "localeCompare(a, a) != 0");
    chk((a < b) === (b > a) && (a === b) === (!(a < b) && !(a > b)), "relational operators inconsistent");

    // Well-formedness and URI coding
    var wf = a.toWellFormed();
    chk(wf.isWellFormed(), "toWellFormed result is not well formed");
    chk(a.isWellFormed() === (wf === a), "isWellFormed disagrees with toWellFormed");
    chk(wf.length === a.length, "toWellFormed changed the length");
    if (a.isWellFormed()) {
        chk(decodeURIComponent(encodeURIComponent(a)) === a, "encodeURIComponent round trip");
        chk(decodeURI(encodeURI(a)) === a, "encodeURI round trip");
    }
    chk(unescape(escape(a)) === a, "escape round trip");
    try { decodeURIComponent(a); } catch (e) { chk(e instanceof URIError, "decodeURIComponent threw " + e); }
    try { decodeURI(a); } catch (e) { chk(e instanceof URIError, "decodeURI threw " + e); }
    chk(Array.from(a).join("") === a, "code point iteration does not reassemble the string");

    // Search methods against a naive reference
    function naiveIndexOf(h, nd, from) {
        for (var i = Math.min(Math.max(0, from), h.length); i + nd.length <= h.length; i++) {   // position is clamped to the length
            var j = 0;
            while (j < nd.length && h.charCodeAt(i + j) === nd.charCodeAt(j)) j++;
            if (j === nd.length) return i;
        }
        return -1;
    }
    function naiveLastIndexOf(h, nd, from) {
        for (var i = Math.min(Math.max(from, 0), h.length - nd.length); i >= 0; i--) {   // position is clamped to [0, length - needle]
            var j = 0;
            while (j < nd.length && h.charCodeAt(i + j) === nd.charCodeAt(j)) j++;
            if (j === nd.length) return i;
        }
        return -1;
    }
    var pairs = [[a, b], [b, a], [a + b + a, b], [a + b, a], [n.NFD, b], [up, lo]];
    for (var p = 0; p < pairs.length; p++) {
        var h = pairs[p][0], nd = pairs[p][1];
        var froms = [0, 1, h.length >> 1, h.length - 1, h.length];
        for (var q = 0; q < froms.length; q++) {
            var from = froms[q];
            var want = naiveIndexOf(h, nd, from);
            chk(h.indexOf(nd, from) === want, "indexOf(" + JSON.stringify(nd) + ", " + from + ") on " + JSON.stringify(h) + " = " + h.indexOf(nd, from) + ", want " + want);
            chk(h.includes(nd, from) === (want >= 0), "includes disagrees with indexOf at " + from);
            var wantLast = naiveLastIndexOf(h, nd, from);
            chk(h.lastIndexOf(nd, from) === wantLast, "lastIndexOf(" + JSON.stringify(nd) + ", " + from + ") on " + JSON.stringify(h) + " = " + h.lastIndexOf(nd, from) + ", want " + wantLast);
            chk(h.startsWith(nd, from) === (naiveIndexOf(h.substring(from, from + nd.length), nd, 0) === 0), "startsWith at " + from);
        }
        chk(h.endsWith(nd) === (nd.length <= h.length && naiveIndexOf(h, nd, h.length - nd.length) === h.length - nd.length), "endsWith");
        if (nd.length > 0) {
            chk(h.split(nd).join(nd) === h, "split/join round trip");
            chk(h.replaceAll(nd, function () { return nd; }) === h, "replaceAll with itself changed the string");   // a function: "$" is special in replacement text
        }
    }
})
