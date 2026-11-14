var K;
function mk() {
  function* g(self) { K = arguments; self = yield 1; yield 2; }
  var it = g(0);
  it.next();
  it.next(it);
}
mk();
var junk = [];
for (var i = 0; i < 1000; i++) junk.push({a: i, b: [i]});
var o = K[0];
o.next();
