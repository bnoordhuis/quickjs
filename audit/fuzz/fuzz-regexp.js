(function (p, f, s) {
    function chk(c, m) { if (!c) throw "ORACLE regexp: " + m + " | /" + p + "/" + f + " on " + JSON.stringify(s); }
    var re;
    try { re = new RegExp(p, f); } catch (e) { return; }

    var m = re.exec(s);
    if (m) {
        chk(m.index >= 0 && m.index + m[0].length <= s.length, "match out of range");
        chk(s.substring(m.index, m.index + m[0].length) === m[0], "match text is not the matched substring");
        chk(m.input === s, "input changed");
        if (m.indices) {
            chk(m.indices.length === m.length, "indices length");
            for (var i = 0; i < m.indices.length; i++) {
                var r = m.indices[i];
                if (r === undefined) { chk(m[i] === undefined, "capture " + i + " set but indices undefined"); continue; }
                chk(0 <= r[0] && r[0] <= r[1] && r[1] <= s.length, "indices out of order for capture " + i + ": " + r);
                chk(s.substring(r[0], r[1]) === m[i], "indices and capture " + i + " disagree");
            }
        }
    }
    re.lastIndex = 0;
    chk(re.test(s) === (m !== null), "test() disagrees with exec()");

    // The source must compile again to an equivalent regexp.
    var re2;
    try { re2 = new RegExp(re.source, re.flags); } catch (e) { chk(false, "source does not recompile: " + re.source + " (" + e + ")"); }
    var m2 = re2.exec(s);
    chk((m === null) === (m2 === null), "recompiled source matches differently");
    if (m && m2) chk(m.index === m2.index && m[0] === m2[0], "recompiled source matches different text");

    re.lastIndex = 0;
    var cleared = s.replace(re, "");
    chk(cleared.length <= s.length, "replace with empty string grew the string");
    re.lastIndex = 0; s.replace(re, "[$1|$2|$<a>|$&|$`|$'|$$]");
    re.lastIndex = 0; s.replace(re, function () { return "x"; });
    re.lastIndex = 0; s.match(re);
    re.lastIndex = 0; chk(s.search(re) === (m ? m.index : -1) || re.sticky || re.global, "search() disagrees with exec()");
    re.lastIndex = 0; s.split(re, 8);
    if (re.global) {
        re.lastIndex = 0;
        var it = s.matchAll(re);
        for (var k = 0; k < 8; k++) if (it.next().done) break;
        re.lastIndex = 0; s.replaceAll(re, "y");
    }
    String(re);
})
