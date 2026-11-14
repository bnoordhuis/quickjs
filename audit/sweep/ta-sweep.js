// Re-entrancy sweep for TypedArray / ArrayBuffer / DataView / Atomics builtins.
//
// Every case calls one builtin on a fresh buffer while an argument (a valueOf,
// a callback, a getter, an iterator, a species constructor) resizes, detaches
// or regrows that buffer mid-call. JS exceptions are expected and ignored; the
// point is to let ASan/UBSan see any access the engine makes with a stale
// pointer or length.
//
// Run:  qjs --std -C ta-sweep.js [START [COUNT [v]]]
// Prints the index of each case before running it (flushed), so a crash can be
// attributed to the last index printed. "v" also prints the description.
// Cases are enumerated deterministically.

const START = +(scriptArgs[1] ?? 0);
const COUNT = +(scriptArgs[2] ?? Infinity);
const VERBOSE = scriptArgs[3] === "v";
let idx = -1, ran = 0, threw = 0;

// Every case is written as `next() && T(desc, fn)`. next() counts the case and
// says whether it is in range, without allocating: under GC stress, building
// the closures for a skipped case would cost a full collection each.
function next() {
    idx++;
    return idx >= START && ran < COUNT;
}
function T(desc, fn) {
    ran++;
    std.out.puts(VERBOSE ? idx + " " + desc() + "\n" : idx + "\n");
    std.out.flush();
    try { fn(); } catch (e) { threw++; }
}

const N = 64;
const TA = Object.getPrototypeOf(Uint8Array);
const KINDS = [Uint8Array, Uint8ClampedArray, Uint16Array, Float64Array, BigInt64Array];
const isBig = (K) => K === BigInt64Array || K === BigUint64Array;

const SETUPS = {
    "rab-track":     (b) => { const buf = new ArrayBuffer(N * b, { maxByteLength: 4 * N * b }); return [buf, [buf]]; },
    "rab-track-off": (b) => { const buf = new ArrayBuffer(N * b, { maxByteLength: 4 * N * b }); return [buf, [buf, 8 * b]]; },
    "rab-fixed":     (b) => { const buf = new ArrayBuffer(N * b, { maxByteLength: 4 * N * b }); return [buf, [buf, 8 * b, 16]]; },
    "ab":            (b) => { const buf = new ArrayBuffer(N * b); return [buf, [buf]]; },
    "gsab-track":    (b) => { const buf = new SharedArrayBuffer(N * b, { maxByteLength: 4 * N * b }); return [buf, [buf]]; },
};
const ACTIONS = {
    shrink0(s) { s.buf.resize(0); },
    shrink1(s) { s.buf.resize(s.b); },
    shrinkHalf(s) { s.buf.resize(N * s.b / 2); },
    grow(s) { if (s.buf.resize) s.buf.resize(4 * N * s.b); else s.buf.grow(4 * N * s.b); },
    detach(s) { s.buf.transfer(); },
    shrinkGrow(s) { s.buf.resize(0); s.buf.resize(2 * N * s.b); },
};
const SETUP_ACTIONS = {
    "rab-track": ["shrink0", "shrink1", "shrinkHalf", "grow", "detach", "shrinkGrow"],
    "rab-track-off": ["shrink0", "shrink1", "shrinkHalf", "grow", "detach", "shrinkGrow"],
    "rab-fixed": ["shrink0", "shrink1", "shrinkHalf", "grow", "detach", "shrinkGrow"],
    "ab": ["detach"],
    "gsab-track": ["grow"],
};

function mk(setup, K) {
    const b = K.BYTES_PER_ELEMENT;
    const [buf, args] = SETUPS[setup](b);
    const ta = new K(...args);
    const big = isBig(K);
    for (let i = 0; i < ta.length; i++) ta[i] = big ? BigInt(i) : i;
    return { buf, ta, b, big, K, v: big ? 1n : 1 };
}
function act(a, s) { try { ACTIONS[a](s); } catch {} }

// Read and write the ends of a view/array so a stale length shows up.
function touch(o) {
    try {
        if (ArrayBuffer.isView(o) && !(o instanceof DataView)) {
            const l = o.length;
            if (l > 0) { o[0] = o[0]; o[l - 1] = o[l - 1]; void o[l >> 1]; }
            void o.byteLength; void o.byteOffset;
        } else if (Array.isArray(o)) {
            const l = o.length;
            if (l > 0) { void o[0]; void o[l - 1]; }
        } else if (o instanceof ArrayBuffer) {
            if (o.byteLength > 0) { const u = new Uint8Array(o); u[0] = u[0]; u[u.length - 1] = u[u.length - 1]; }
        }
    } catch {}
}

// --- evil argument builders -------------------------------------------------

function evilNum(s, a, ret) {
    let done = false;
    const f = () => { if (!done) { done = true; act(a, s); } return ret; };
    return { valueOf: f, toString: () => String(f()) };
}
function evilCb(s, a, ret, trigger) {
    let n = 0;
    return function (x) { if (n++ === trigger) act(a, s); return ret === "id" ? x : ret; };
}
function evilLike(s, a, variant) {
    const v = s.v;
    switch (variant) {
    case 0: return { length: evilNum(s, a, 4), 0: v, 1: v, 2: v, 3: v };
    case 1: return { length: 4, 0: v, get 1() { act(a, s); return v; }, 2: v, 3: v };
    default: return {
        [Symbol.iterator]() {
            let i = 0;
            return { next() { if (i === 1) act(a, s); return i++ < 4 ? { value: v, done: false } : { value: undefined, done: true }; } };
        },
    };
    }
}
const NUM_RETS = [0, 1, N - 1, N, -1, 3 * N, 1n];
const CB_RETS = ["id", true, 0, -1];

function evilVariants(s, a) {
    const out = [];
    for (const r of NUM_RETS) out.push(["num:" + r, () => evilNum(s, a, r)]);
    for (const r of CB_RETS) for (const t of [0, 2]) out.push(["cb:" + r + "@" + t, () => evilCb(s, a, r, t)]);
    for (const v of [0, 1, 2]) out.push(["like:" + v, () => evilLike(s, a, v)]);
    return out;
}
const EVIL_NAMES = evilVariants(null, null).map(([n]) => n);

function profiles(s) {
    const v = s.v;
    return {
        nums: [v, 2, 3, 4],
        idxval: [1, v, 2, 3],
        cb: [(x) => x, 0, 1, 2],
        src: [[v, v, v], 1, 2, 3],
    };
}
const PROFILE_NAMES = ["nums", "idxval", "cb", "src"];

const fnNames = (o) => Reflect.ownKeys(o).filter((k) => k !== "constructor" && typeof Object.getOwnPropertyDescriptor(o, k).value === "function");

function eachSetup(f) {
    for (const K of KINDS)
        for (const setup of Object.keys(SETUPS))
            for (const a of SETUP_ACTIONS[setup])
                f(K, setup, a);
}

// --- 1. prototype methods with one evil argument ----------------------------

function sweepMethods(label, proto, names) {
    for (const m of names) {
        eachSetup((K, setup, a) => {
            for (const p of PROFILE_NAMES)
                for (let pos = 0; pos < 4; pos++)
                    for (let e = 0; e < EVIL_NAMES.length; e++)
                        next() && T(() => `${label}.${String(m)} ${K.name} ${setup} ${a} profile=${p} pos=${pos} evil=${EVIL_NAMES[e]}`, () => {
                            const s = mk(setup, K);
                            const args = profiles(s)[p];
                            args[pos] = evilVariants(s, a)[e][1]();
                            let r;
                            try { r = proto[m].apply(s.ta, args); } finally { touch(s.ta); }
                            touch(r);
                        });
        });
    }
}
sweepMethods("TA", TA.prototype, fnNames(TA.prototype));
sweepMethods("Array", Array.prototype, fnNames(Array.prototype).filter((m) => !["push", "unshift", "splice", "pop", "shift"].includes(m)));

// --- 2. species constructors -------------------------------------------------

const SPECIES = {
    act: (s, a, args) => { act(a, s); return new s.K(...args); },
    short: (s, a, args) => { act(a, s); return new s.K(1); },
    same: (s, a, args) => { act(a, s); return new s.K(s.buf); },
    sameNoAct: (s, a, args) => new s.K(s.buf),
    otherKind: (s, a, args) => { act(a, s); const O = s.big ? BigUint64Array : (s.K === Uint8Array ? Float64Array : Uint8Array); return new O(...args); },
    rabTarget: (s, a, args) => {   // result lives on a second resizable buffer that the callback shrinks
        const n = typeof args[0] === "number" ? args[0] : N;
        s.buf2 = new ArrayBuffer(n * s.b, { maxByteLength: 4 * N * s.b });
        return new s.K(s.buf2);
    },
};
for (const m of fnNames(TA.prototype)) {
    eachSetup((K, setup, a) => {
        for (const mode of Object.keys(SPECIES))
            for (const p of PROFILE_NAMES)
                next() && T(() => `species TA.${String(m)} ${K.name} ${setup} ${a} mode=${mode} profile=${p}`, () => {
                    const s = mk(setup, K);
                    const args = profiles(s)[p];
                    if (mode === "rabTarget") {
                        let n = 0;
                        args[0] = function (x) { if (n++ === 2 && s.buf2) { try { s.buf2.resize(0); } catch {} } return x; };
                    }
                    s.ta.constructor = { [Symbol.species]: function (...cargs) { return SPECIES[mode](s, a, cargs); } };
                    let r;
                    try { r = TA.prototype[m].apply(s.ta, args); } finally { touch(s.ta); }
                    touch(r);
                });
    });
}

// --- 3. element access, definition, assignment -------------------------------

eachSetup((K, setup, a) => {
    for (const i of [0, 1, 15, N - 1])
        for (const r of [1, 1n, 255]) {
            const d = (what) => () => `${what} ${K.name} ${setup} ${a} i=${i} ret=${r}`;
            next() && T(d("ta[i]=evil"), () => { const s = mk(setup, K); try { s.ta[i] = evilNum(s, a, r); } finally { touch(s.ta); } });
            next() && T(d("ta[i]+=evil"), () => { const s = mk(setup, K); try { s.ta[i] += evilNum(s, a, r); } finally { touch(s.ta); } });
            next() && T(d("ta[evil]=v"), () => { const s = mk(setup, K); try { s.ta[evilNum(s, a, i)] = s.v; } finally { touch(s.ta); } });
            next() && T(d("ta[evil]"), () => { const s = mk(setup, K); try { void s.ta[evilNum(s, a, i)]; } finally { touch(s.ta); } });
            next() && T(d("Reflect.set"), () => { const s = mk(setup, K); try { Reflect.set(s.ta, i, evilNum(s, a, r)); } finally { touch(s.ta); } });
            next() && T(d("Reflect.set receiver"), () => { const s = mk(setup, K); try { Reflect.set({}, i, evilNum(s, a, r), s.ta); Reflect.set(s.ta, i, s.v, new Proxy(s.ta, {})); } finally { touch(s.ta); } });
            next() && T(d("defineProperty value"), () => { const s = mk(setup, K); try { Object.defineProperty(s.ta, i, { value: evilNum(s, a, r) }); } finally { touch(s.ta); } });
            next() && T(d("defineProperty desc getter"), () => {
                const s = mk(setup, K);
                try { Object.defineProperty(s.ta, i, { get value() { act(a, s); return s.v; }, writable: true, enumerable: true, configurable: true }); } finally { touch(s.ta); }
            });
            next() && T(d("Object.assign"), () => {
                const s = mk(setup, K);
                try { Object.assign(s.ta, { get 0() { act(a, s); return s.v; }, [i]: s.v, [N - 1]: s.v }); } finally { touch(s.ta); }
            });
            next() && T(d("destructure-assign"), () => { const s = mk(setup, K); try { [s.ta[i], s.ta[N - 1]] = [evilNum(s, a, r), s.v]; } finally { touch(s.ta); } });
        }
    const d = (what) => () => `${what} ${K.name} ${setup} ${a}`;
    for (const at of [0, 1, 5])
        next() && T(d("iterate values@" + at), () => {
            const s = mk(setup, K); let n = 0;
            try { for (const x of s.ta) { if (n++ === at) act(a, s); } } finally { touch(s.ta); }
        });
    next() && T(d("iterators after action"), () => {
        const s = mk(setup, K);
        const its = [s.ta.values(), s.ta.keys(), s.ta.entries()];
        for (const it of its) it.next();
        act(a, s);
        for (const it of its) { try { it.next(); it.next(); } catch {} }
        touch(s.ta);
    });
    next() && T(d("spread/Array.from/Set"), () => {
        const s = mk(setup, K); let n = 0;
        try { Array.from(s.ta, (x) => { if (n++ === 1) act(a, s); return x; }); } catch {}
        try { touch([...s.ta]); new Set(s.ta); } finally { touch(s.ta); }
    });
    for (const which of ["Number", "BigInt"])
        next() && T(d("toLocaleString hook " + which), () => {
            const s = mk(setup, K);
            const P = globalThis[which].prototype, saved = P.toLocaleString; let n = 0;
            P.toLocaleString = function () { if (n++ === 1) act(a, s); return "x"; };
            try { s.ta.toLocaleString(); } finally { P.toLocaleString = saved; touch(s.ta); }
        });
    next() && T(d("JSON.stringify replacer"), () => {
        const s = mk(setup, K); let n = 0;
        try { JSON.stringify(s.ta, (k, v) => { if (n++ === 2) act(a, s); return typeof v === "bigint" ? 0 : v; }); } finally { touch(s.ta); }
    });
    next() && T(d("Object.freeze/seal/keys after action"), () => {
        const s = mk(setup, K);
        act(a, s);
        for (const f of [Object.freeze, Object.seal, Object.keys, Object.entries, Object.getOwnPropertyNames, Object.isFrozen, Object.preventExtensions])
            try { touch(f(s.ta)); } catch {}
        touch(s.ta);
    });
    next() && T(d("set(other view on same buffer)"), () => {
        const s = mk(setup, K);
        const other = new Uint8Array(s.buf);
        try { s.ta.set(other, evilNum(s, a, 0)); } catch {}
        try { other.set(s.ta, evilNum(mk(setup, K), a, 0)); } finally { touch(s.ta); touch(other); }
    });
});

// --- 4. constructors ---------------------------------------------------------

function evilNewTarget(s, a, proto) {
    const NT = function () {}.bind();
    Object.defineProperty(NT, "prototype", { get() { act(a, s); return proto; } });
    return NT;
}
eachSetup((K, setup, a) => {
    const d = (what) => () => `${what} ${K.name} ${setup} ${a}`;
    for (const off of [0, 8, N])
        for (const len of [1, 16, N, undefined]) {
            next() && T(d(`new K(buf, evil ${off}, ${len})`), () => { const s = mk(setup, K); const r = new K(s.buf, evilNum(s, a, off * s.b), len); touch(r); touch(s.ta); });
            next() && T(d(`new K(buf, ${off}, evil ${len})`), () => { const s = mk(setup, K); const r = new K(s.buf, off * s.b, evilNum(s, a, len ?? 1)); touch(r); touch(s.ta); });
            next() && T(d(`construct K(buf, ${off}, ${len}) evil newTarget`), () => {
                const s = mk(setup, K);
                const r = Reflect.construct(K, len === undefined ? [s.buf, off * s.b] : [s.buf, off * s.b, len], evilNewTarget(s, a, K.prototype));
                touch(r); touch(s.ta);
            });
            next() && T(d(`new DataView(buf, evil ${off}, ${len})`), () => { const s = mk(setup, K); const r = new DataView(s.buf, evilNum(s, a, off * s.b), len); r.getUint8(0); r.getUint8(r.byteLength - 1); });
            next() && T(d(`new DataView(buf, ${off}, evil ${len})`), () => { const s = mk(setup, K); const r = new DataView(s.buf, off * s.b, evilNum(s, a, len ?? 1)); r.getUint8(0); r.getUint8(r.byteLength - 1); });
            next() && T(d(`construct DataView(buf, ${off}, ${len}) evil newTarget`), () => {
                const s = mk(setup, K);
                const r = Reflect.construct(DataView, len === undefined ? [s.buf, off * s.b] : [s.buf, off * s.b, len], evilNewTarget(s, a, DataView.prototype));
                r.getUint8(0); r.getUint8(r.byteLength - 1);
            });
        }
    next() && T(d("construct K(ta) evil newTarget"), () => { const s = mk(setup, K); touch(Reflect.construct(K, [s.ta], evilNewTarget(s, a, K.prototype))); touch(s.ta); });
    next() && T(d("new K(ta of other kind) after action in species-free path"), () => {
        const s = mk(setup, K);
        const O = s.big ? BigUint64Array : (K === Uint8Array ? Float64Array : Uint8Array);
        touch(Reflect.construct(O, [s.ta], evilNewTarget(s, a, O.prototype))); touch(s.ta);
    });
    for (const e of [0, 1, 2])
        next() && T(d("K.from(evil like " + e + ") into view on buf"), () => {
            const s = mk(setup, K);
            const C = function (n) { return s.ta; };
            try { touch(K.from.call(C, evilLike(s, a, e))); } finally { touch(s.ta); }
        });
    next() && T(d("K.from(src, evil mapFn) into view on buf"), () => {
        const s = mk(setup, K); let n = 0;
        const C = function () { return s.ta; };
        try { touch(K.from.call(C, [s.v, s.v, s.v, s.v], (x) => { if (n++ === 1) act(a, s); return x; })); } finally { touch(s.ta); }
    });
    next() && T(d("K.of(evil...) into view on buf"), () => {
        const s = mk(setup, K);
        const C = function () { return s.ta; };
        try { touch(K.of.call(C, s.v, evilNum(s, a, s.v), s.v, s.v)); } finally { touch(s.ta); }
    });
    next() && T(d("K.from(ta, evil mapFn)"), () => {
        const s = mk(setup, K); let n = 0;
        try { touch(K.from(s.ta, (x) => { if (n++ === 1) act(a, s); return x; })); } finally { touch(s.ta); }
    });
});

// --- 5. DataView accessors, Atomics, ArrayBuffer methods ---------------------

eachSetup((K, setup, a) => {
    if (K !== Uint8Array && K !== Float64Array) return;   // buffer-level: two sizes are enough
    for (const dvArgs of [[], [8], [8, 16]])
        for (const m of fnNames(DataView.prototype))
            for (const base of [[0, 1, true], [0, 1n, true], [8, 1, false]])
                for (let pos = 0; pos < 3; pos++)
                    for (const r of [0, 1, 8, 15, N * K.BYTES_PER_ELEMENT - 1, -1, 1n])
                        next() && T(() => `DataView.${m} ${K.name} ${setup} ${a} dv=${dvArgs} base=${base.map(String)} pos=${pos} ret=${r}`, () => {
                            const s = mk(setup, K);
                            const dv = new DataView(s.buf, ...dvArgs);
                            const args = base.slice();
                            args[pos] = evilNum(s, a, r);
                            try { dv[m](...args); } finally { touch(s.ta); }
                        });
    for (const m of fnNames(ArrayBuffer.prototype))
        for (let pos = 0; pos < 2; pos++)
            for (const r of [0, 8, N * K.BYTES_PER_ELEMENT, 2 * N * K.BYTES_PER_ELEMENT, -1, 2 ** 31])
                next() && T(() => `ArrayBuffer.${m} ${K.name} ${setup} ${a} pos=${pos} ret=${r}`, () => {
                    const s = mk(setup, K);
                    if (!(s.buf instanceof ArrayBuffer)) return;
                    const args = [0, 16];
                    args[pos] = evilNum(s, a, r);
                    let res;
                    try { res = s.buf[m](...args); } finally { touch(s.ta); }
                    touch(res);
                });
    for (const mode of ["new", "same", "small", "detached", "rab"])
        next() && T(() => `ArrayBuffer.slice species ${K.name} ${setup} ${a} mode=${mode}`, () => {
            const s = mk(setup, K);
            if (!(s.buf instanceof ArrayBuffer)) return;
            s.buf.constructor = { [Symbol.species]: function (len) {
                act(a, s);
                switch (mode) {
                case "new": return new ArrayBuffer(len);
                case "same": return s.buf;
                case "small": return new ArrayBuffer(1);
                case "detached": { const b = new ArrayBuffer(len); b.transfer(); return b; }
                default: return new ArrayBuffer(len, { maxByteLength: 2 * len + 8 });
                }
            } };
            let res;
            try { res = s.buf.slice(0, 32); } finally { touch(s.ta); }
            touch(res);
        });
});

for (const K of [Int8Array, Uint8Array, Int32Array, BigInt64Array])
    for (const setup of Object.keys(SETUPS))
        for (const a of SETUP_ACTIONS[setup])
            for (const m of ["add", "and", "or", "sub", "xor", "exchange", "compareExchange", "load", "store", "notify"])
                for (let pos = 1; pos < 4; pos++)
                    for (const r of [0, 1, N - 1, N, 1n])
                        next() && T(() => `Atomics.${m} ${K.name} ${setup} ${a} pos=${pos} ret=${r}`, () => {
                            const s = mk(setup, K);
                            const args = [s.ta, 1, s.v, s.v];
                            args[pos] = evilNum(s, a, r);
                            try { Atomics[m](...args); } finally { touch(s.ta); }
                        });

// --- 6. Uint8Array base64 / hex ----------------------------------------------

for (const setup of Object.keys(SETUPS))
    for (const a of SETUP_ACTIONS[setup]) {
        const opts = (s, key) => ({ get [key]() { act(a, s); return undefined; } });
        const d = (what) => () => `${what} Uint8Array ${setup} ${a}`;
        for (const key of ["alphabet", "lastChunkHandling", "omitPadding"]) {
            next() && T(d("setFromBase64 opts." + key), () => { const s = mk(setup, Uint8Array); try { s.ta.setFromBase64("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=", opts(s, key)); } finally { touch(s.ta); } });
            next() && T(d("toBase64 opts." + key), () => { const s = mk(setup, Uint8Array); try { s.ta.toBase64(opts(s, key)); } finally { touch(s.ta); } });
        }
        next() && T(d("setFromHex"), () => { const s = mk(setup, Uint8Array); act(a, s); try { s.ta.setFromHex("00112233445566778899aabbccddeeff"); } finally { touch(s.ta); } });
        next() && T(d("toHex/toBase64 after action"), () => { const s = mk(setup, Uint8Array); act(a, s); try { s.ta.toHex(); s.ta.toBase64(); } finally { touch(s.ta); } });
    }

std.err.puts(`cases=${idx + 1} ran=${ran} threw=${threw}\n`);
