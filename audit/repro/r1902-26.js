var a = "x".repeat(600), b = "y".repeat(600);
var r = a + b;                                   // rope
var flat = (r + "z").substring(0, 1200);         // equal content, different representation
var s = new Set([r]);
s.add(flat);
var m = /(?<=([\q{ab}]))c/dv.exec("abc");
print(JSON.stringify({ equal: r === flat, setHas: new Set([r]).has(flat), setSize: s.size,
                       lookbehind: m && [m[0], m[1], m.indices[1]] }));
