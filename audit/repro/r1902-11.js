// in-place concat must not mutate a string that is also an atom
function mk() { let s = "ab".repeat(5) + "c"; ({})[s]; return s; }
var o = {};
var k = mk() + "d";
o[k] = 1;
var fresh = ["ababababab", "cd"].join("");
print(JSON.stringify({ k, same: k === fresh, lookup: o[fresh], hasOwn: Object.hasOwn(o, fresh) }));
