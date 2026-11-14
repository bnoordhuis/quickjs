var m = new Map();
m.set('a', 0);
m.set('b', 0);
var it = m.keys();
it.next(); it.next();
m.delete('b');
m.set('a', it);
it = null;
m.clear();
