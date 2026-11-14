// Overriding Promise.prototype.then must not affect AsyncDisposableStack.disposeAsync()
const log = [];
const st = new AsyncDisposableStack();
for (const n of ["A", "B", "C"]) st.defer(async () => { log.push(n); });
const origThen = Promise.prototype.then;
Promise.prototype.then = function () { Promise.prototype.then = origThen; throw "tampered"; };
let threw;
try { st.disposeAsync().catch(() => {}); } catch (e) { threw = e; }
Promise.prototype.then = origThen;
for (let i = 0; i < 20; i++) await null;
print(JSON.stringify({ threw, log, disposed: st.disposed, expected: ["C", "B", "A"] }));
