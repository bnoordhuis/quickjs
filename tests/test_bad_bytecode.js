import * as std from "qjs:std";
import * as bjson from "qjs:bjson";

let o = std.evalScript(";(function f(){})", {compile_only: true});
let b = bjson.write(o, /*JS_WRITE_OBJ_BYTECODE*/(1 << 0));
let r = [...new Uint8Array(b)].map(tohex).join("");
// replace the { fclosure8; set_loc0; return } of the function body
// with bad bytecode; very evil, very brittle
r = r.replace("bf00cd28", "bf00cdff");
r = r.match(/../g).map(fromhex);
b = new Uint8Array(r).buffer;
o = bjson.read(b, 0, b.byteLength, /*JS_READ_OBJ_BYTECODE*/(1 << 0));
o = std.evalScript(o, {eval_function: true});
o();

function tohex(c) {
    const h = "0123456789abcdef";
    return h[c >> 4] + h[c & 15];
}

function fromhex(c) {
    const h = "0123456789abcdef";
    return 16 * h.indexOf(c[0]) + h.indexOf(c[1]);
}
