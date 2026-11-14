// Re-entrancy sweep for Array builtins on fast arrays and arguments objects.
//
// Every case calls one builtin on a fresh array while an argument (a valueOf,
// a callback, a getter, an element's toString, a species constructor) shrinks,
// grows, replaces or de-optimises that array mid-call. JS exceptions are
// expected and ignored; ASan/UBSan are the oracle.
//
// Run:  qjs --std -C array-sweep.js [START [COUNT [v]]]   (see ta-sweep.js)

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
const AP = Array.prototype;

// Targets. Elements are heap objects where possible, so a stale element
// pointer is a use-after-free that ASan can see.
const SETUPS = {
    "arr-obj": () => { const t = []; for (let i = 0; i < N; i++) t.push({ i }); return t; },
    "arr-num": () => { const t = []; for (let i = 0; i < N; i++) t.push(i); return t; },
    "arr-str": () => { const t = []; for (let i = 0; i < N; i++) t.push("s" + i + "x".repeat(i)); return t; },
    "args-mapped": () => (function (a, b, c) { return arguments; })(...Array.from({ length: N }, (_, i) => ({ i }))),
    "args-strict": () => (function () { "use strict"; return arguments; })(...Array.from({ length: N }, (_, i) => ({ i }))),
};
const ACTIONS = {
    len0(t) { t.length = 0; AP.splice.call(t, 0); },
    len1(t) { AP.splice.call(t, 1); },
    pop(t) { for (let i = 0; i < N - 2; i++) AP.pop.call(t); },
    shift(t) { for (let i = 0; i < N / 2; i++) AP.shift.call(t); },
    grow(t) { for (let i = 0; i < 1000; i++) AP.push.call(t, { g: i }); },
    shrinkGrow(t) { AP.splice.call(t, 0); for (let i = 0; i < 2 * N; i++) AP.push.call(t, { g: i }); },
    replace(t) { for (let i = 0; i < t.length; i++) t[i] = { r: i }; },
    slow(t) { Object.defineProperty(t, 0, { get() { return 1; }, configurable: true }); },
    hole(t) { delete t[N >> 1]; delete t[1]; },
    far(t) { t[5000] = { far: 1 }; },
    freeze(t) { Object.freeze(t); },
};
const ACTION_NAMES = Object.keys(ACTIONS);
function act(a, t) { try { ACTIONS[a](t); } catch {} }

function touch(o) {
    try {
        if (o !== null && typeof o === "object" && typeof o.length === "number") {
            const l = Math.min(o.length, 4096);
            for (let i = 0; i < l; i++) { const e = o[i]; if (e !== null && typeof e === "object") void e.i; }
        }
    } catch {}
}

// --- evil argument builders -------------------------------------------------

function evilNum(t, a, ret) {
    let done = false;
    const f = () => { if (!done) { done = true; act(a, t); } return ret; };
    return { valueOf: f, toString: () => String(f()), toLocaleString: () => String(f()) };
}
function evilCb(t, a, ret, trigger) {
    let n = 0;
    return function (x) { if (n++ === trigger) act(a, t); return ret === "id" ? x : ret; };
}
function evilLike(t, a, variant) {
    switch (variant) {
    case 0: return { length: evilNum(t, a, 4), 0: {}, 1: {}, 2: {}, 3: {} };
    case 1: return { length: 4, 0: {}, get 1() { act(a, t); return {}; }, 2: {}, 3: {} };
    case 2: return { length: 4, 0: {}, 1: {}, 2: {}, 3: {}, get [Symbol.isConcatSpreadable]() { act(a, t); return true; } };
    default: return {
        [Symbol.iterator]() {
            let i = 0;
            return { next() { if (i === 1) act(a, t); return i++ < 4 ? { value: {}, done: false } : { value: undefined, done: true }; } };
        },
    };
    }
}
const NUM_RETS = [0, 1, N - 1, N, -1, 3 * N];
const CB_RETS = ["id", true, 0, -1];
const CB_TRIGGERS = [0, 2, 40];

function evilVariants(t, a) {
    const out = [];
    for (const r of NUM_RETS) out.push(["num:" + r, () => evilNum(t, a, r)]);
    for (const r of CB_RETS) for (const g of CB_TRIGGERS) out.push(["cb:" + r + "@" + g, () => evilCb(t, a, r, g)]);
    for (const v of [0, 1, 2, 3]) out.push(["like:" + v, () => evilLike(t, a, v)]);
    return out;
}
const EVIL_NAMES = evilVariants(null, null).map(([n]) => n);

const PROFILES = {
    nums: () => [1, 2, 3, 4],
    cb: () => [(x) => x, 0, 1, 2],
    vals: () => [{}, 1, 2, 3],
    arr: () => [[{}, {}, {}], 1, 2, 3],
};
const PROFILE_NAMES = Object.keys(PROFILES);
const fnNames = (o) => Reflect.ownKeys(o).filter((k) => k !== "constructor" && typeof Object.getOwnPropertyDescriptor(o, k).value === "function");
const METHODS = fnNames(AP);

function eachSetup(f) {
    for (const setup of Object.keys(SETUPS))
        for (const a of ACTION_NAMES)
            f(setup, a);
}

// --- 1. prototype methods with one evil argument ----------------------------

for (const m of METHODS)
    eachSetup((setup, a) => {
        for (const p of PROFILE_NAMES)
            for (let pos = 0; pos < 4; pos++)
                for (let e = 0; e < EVIL_NAMES.length; e++)
                    next() && T(() => `Array.${String(m)} ${setup} ${a} profile=${p} pos=${pos} evil=${EVIL_NAMES[e]}`, () => {
                        const t = SETUPS[setup]();
                        const args = PROFILES[p]();
                        args[pos] = evilVariants(t, a)[e][1]();
                        let r;
                        try { r = AP[m].apply(t, args); } finally { touch(t); }
                        touch(r);
                    });
    });

// --- 2. an element whose conversion re-enters --------------------------------

for (const m of METHODS)
    eachSetup((setup, a) => {
        for (const p of PROFILE_NAMES)
            for (const at of [0, 1, N - 1])
                for (const ret of [0, "a", "zzz"])
                    next() && T(() => `evil element Array.${String(m)} ${setup} ${a} profile=${p} at=${at} ret=${ret}`, () => {
                        const t = SETUPS[setup]();
                        t[at] = evilNum(t, a, ret);
                        let r;
                        try { r = AP[m].apply(t, PROFILES[p]()); } finally { touch(t); }
                        touch(r);
                    });
    });

// --- 3. species constructors -------------------------------------------------

const SPECIES = {
    act: (t, a, n) => { act(a, t); return new Array(n); },
    empty: (t, a, n) => { act(a, t); return []; },
    same: (t, a, n) => { act(a, t); return t; },
    sameNoAct: (t, a, n) => t,
    typed: (t, a, n) => { act(a, t); return new Uint8Array(n); },
    frozen: (t, a, n) => { act(a, t); return Object.freeze(new Array(n)); },
    // the action fires once: it can itself call the species constructor, and re-entering it from every trap is exponential
    proxy: (t, a, n) => { const r = []; let done = false; return new Proxy(r, { defineProperty(o, k, d) { if (!done && !t.__acted) { done = t.__acted = true; act(a, t); } return Reflect.defineProperty(o, k, d); } }); },
};
for (const m of METHODS)
    eachSetup((setup, a) => {
        if (!setup.startsWith("arr")) return;
        for (const mode of Object.keys(SPECIES))
            for (const p of PROFILE_NAMES)
                next() && T(() => `species Array.${String(m)} ${setup} ${a} mode=${mode} profile=${p}`, () => {
                    const t = SETUPS[setup]();
                    t.constructor = { [Symbol.species]: function (n) { return SPECIES[mode](t, a, n); } };
                    let r;
                    try { r = AP[m].apply(t, PROFILES[p]()); } finally { touch(t); }
                    touch(r);
                });
    });

// --- 4. length, element assignment, iteration, other consumers ---------------

eachSetup((setup, a) => {
    const d = (what) => () => `${what} ${setup} ${a}`;
    const mk = SETUPS[setup];
    for (const r of [0, 1, N / 2, N, 2 * N, 2 ** 32 - 1])
        next() && T(d("length=evil " + r), () => { const t = mk(); try { t.length = evilNum(t, a, r); } finally { touch(t); } });
    for (const r of [0, 1, N / 2, 2 * N])
        next() && T(d("defineProperty length evil " + r), () => { const t = mk(); try { Object.defineProperty(t, "length", { value: evilNum(t, a, r) }); } finally { touch(t); } });
    for (const i of [0, 1, N - 1, N]) {
        next() && T(d("t[evil]=v " + i), () => { const t = mk(); try { t[evilNum(t, a, i)] = {}; } finally { touch(t); } });
        next() && T(d("t[evil] " + i), () => { const t = mk(); try { touch([t[evilNum(t, a, i)]]); } finally { touch(t); } });
        next() && T(d("t[i]+=evil " + i), () => { const t = mk(); try { t[i] += evilNum(t, a, 1); } finally { touch(t); } });
        next() && T(d("t[i]++ on evil element " + i), () => { const t = mk(); t[i] = evilNum(t, a, 1); try { t[i]++; } finally { touch(t); } });
        next() && T(d("delete t[evil] " + i), () => { const t = mk(); try { delete t[evilNum(t, a, i)]; } finally { touch(t); } });
        next() && T(d("evil in t " + i), () => { const t = mk(); try { void (evilNum(t, a, i) in t); } finally { touch(t); } });
    }
    for (const at of [0, 1, 5, 40]) {
        next() && T(d("for-of@" + at), () => { const t = mk(); let n = 0; try { for (const x of AP.values.call(t)) { if (n++ === at) act(a, t); if (x && typeof x === "object") void x.i; } } finally { touch(t); } });
        next() && T(d("for-in@" + at), () => { const t = mk(); let n = 0; try { for (const k in t) { if (n++ === at) act(a, t); void t[k]; } } finally { touch(t); } });
        next() && T(d("destructure@" + at), () => {
            const t = mk(); let n = 0;
            const it = { [Symbol.iterator]() { const i = AP.values.call(t); return { next() { if (n++ === at) act(a, t); return i.next(); } }; } };
            try { const [x, y, ...rest] = it; touch(rest); } finally { touch(t); }
        });
    }
    next() && T(d("iterators after action"), () => {
        const t = mk();
        const its = [AP.values.call(t), AP.keys.call(t), AP.entries.call(t)];
        for (const it of its) it.next();
        act(a, t);
        for (const it of its) { try { touch([it.next().value, it.next().value]); } catch {} }
        touch(t);
    });
    const consumers = {
        "Array.from mapFn": (t, cb) => Array.from(t, cb),
        "Object.groupBy": (t, cb) => Object.groupBy(t, cb),
        "Map.groupBy": (t, cb) => Map.groupBy(t, cb),
        "flatMap inner": (t, cb) => [1, 2, 3].flatMap((x) => { cb(x); return t; }),
        "concat arg": (t, cb) => [].concat(t, { get [Symbol.isConcatSpreadable]() { cb(); cb(); cb(); return false; } }, t),
        "JSON.stringify replacer": (t, cb) => JSON.stringify(t, (k, v) => { cb(v); return v; }),
        "JSON.stringify toJSON": (t, cb) => { t[1] = { toJSON() { cb(); cb(); cb(); return 1; } }; return JSON.stringify(t); },
        "Promise.all": (t, cb) => { const C = function (ex) { ex(() => {}, () => {}); }; C.resolve = (x) => { cb(x); return { then() {} }; }; return Promise.all.call(C, t); },
        "new Set(iter)": (t, cb) => { const S = class extends Set { add(x) { cb(x); return super.add(x); } }; return new S(t); },
        "new Map(pairs)": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = [i, t[i]]; const M = class extends Map { set(k, v) { cb(k); return super.set(k, v); } }; return new M(t); },
        "Object.fromEntries": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = [{ toString() { cb(); return "k" + i; } }, 1]; return Object.fromEntries(t); },
        "String.raw": (t, cb) => String.raw({ raw: t }, { toString() { cb(); cb(); cb(); return ""; } }, 1, 2),
        "Reflect.ownKeys+get": (t, cb) => { for (const k of Reflect.ownKeys(t)) { cb(); void t[k]; } },
        "Object.assign from": (t, cb) => Object.assign({ set 2(v) { cb(); cb(); cb(); } }, t),
        "Object.assign to": (t, cb) => Object.assign(t, { get 0() { cb(); cb(); cb(); return {}; }, 1: {}, [N - 1]: {} }),
        "Object.defineProperties": (t, cb) => Object.defineProperties({}, Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i, { get value() { cb(); return t; } }]))),
        "spread call": (t, cb) => Math.max(...AP.map.call(t, (x) => { cb(x); return 1; })),
        "apply evil elements": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = { valueOf() { cb(); return i; } }; return Math.max.apply(null, t); },
        "fromCharCode evil elements": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = { valueOf() { cb(); return 65; } }; return String.fromCharCode.apply(null, t); },
        "new Array(...t) evil": (t, cb) => Reflect.construct(Array, t, Object.defineProperty(function () {}.bind(), "prototype", { get() { cb(); cb(); cb(); return AP; } })),
        "template join": (t, cb) => { t[2] = { toString() { cb(); cb(); cb(); return "x"; } }; return `${t}`; },
        "sort default evil toString": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = { toString() { cb(); return "k" + (i % 7); } }; return AP.sort.call(t); },
        "toSorted default evil toString": (t, cb) => { for (let i = 0; i < t.length; i++) t[i] = { toString() { cb(); return "k" + (i % 7); } }; return AP.toSorted.call(t); },
        "includes/indexOf proxy elements": (t, cb) => AP.indexOf.call(new Proxy(t, { get(o, k, r) { cb(); return Reflect.get(o, k, r); } }), 1),
        "JSON.parse reviver": (t, cb) => JSON.parse("[[1,2,3,4,5,6,7,8],[1,2,3,4,5,6,7,8],{\"a\":[1,2,3]}]", function (k, v) {
            if (Array.isArray(this) && k === "2") act(a, this);
            if (Array.isArray(v) && v.length > 2) { cb(); }
            return v;
        }),
    };
    for (const [name, f] of Object.entries(consumers))
        for (const trigger of [0, 2, 9])
            next() && T(d(name + " @" + trigger), () => {
                const t = mk(); let n = 0, r;
                try { r = f(t, () => { if (n++ === trigger) act(a, t); return 0; }); } finally { touch(t); }
                touch(r);
            });
});

// --- 5. static constructors writing into a caller-supplied array -------------

eachSetup((setup, a) => {
    if (!setup.startsWith("arr")) return;
    const d = (what) => () => `${what} ${setup} ${a}`;
    const mk = SETUPS[setup];
    for (const e of [0, 1, 3])
        next() && T(d("Array.from(evil like " + e + ") into t"), () => { const t = mk(); try { touch(Array.from.call(function () { return t; }, evilLike(t, a, e))); } finally { touch(t); } });
    next() && T(d("Array.from(src, evil mapFn) into t"), () => {
        const t = mk(); let n = 0;
        try { touch(Array.from.call(function () { return t; }, [{}, {}, {}, {}], (x) => { if (n++ === 1) act(a, t); return x; })); } finally { touch(t); }
    });
    next() && T(d("Array.of(evil...) into t"), () => { const t = mk(); try { touch(Array.of.call(function () { return t; }, {}, {}, {})); } finally { touch(t); } });
});

std.err.puts(`cases=${idx + 1} ran=${ran} threw=${threw}\n`);
