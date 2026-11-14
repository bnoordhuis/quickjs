// module code: await is a keyword everywhere, but a plain function is not async
let r;
try { (0, eval)("1"); } catch {}
function f() { for (await using x of []) {} }
print("module: plain function with for-await-using compiled");
