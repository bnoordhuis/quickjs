// Shared code for the libFuzzer targets in this directory.
//
// Each target evaluates a fixed driver script (<target>.js, loaded from the
// directory of the executable) that returns a function, then calls that
// function with values built from the fuzz input. The driver throws a string
// starting with "ORACLE" when an invariant is violated; that aborts the
// process so libFuzzer records the input. All other exceptions are ignored.
//
// The runtime and the compiled driver are reused across inputs and recreated
// every FZ_REUSE inputs (about 40x faster than a fresh runtime per input, and
// tearing the runtime down still asserts that no GC object leaked). Drivers
// keep no state between calls. If a crash does not reproduce from its input
// alone, an earlier input corrupted the shared runtime: set FZ_FRESH=1 to use
// a fresh runtime for every input when reproducing.
// Execution is bounded by a deterministic interrupt budget, with a wall-clock
// limit (FZ_WALL_MS) as a backstop for inputs whose interrupt intervals are
// themselves slow.
#ifndef FUZZ_COMMON_H
#define FUZZ_COMMON_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "quickjs.h"

#define FZ_MAX_UNITS 8192

#define FZ_REUSE 1000
#define FZ_WALL_MS 1500

typedef struct {
    JSRuntime *rt;
    JSContext *ctx;
    JSValue fn;      // the driver function
    int budget;
    int uses;
    double deadline;   // ms, CLOCK_MONOTONIC
} Fuzz;

static char *fz_driver_src;
static size_t fz_driver_len;

// Loads <dir of argv[0]>/<name>. Called from LLVMFuzzerInitialize.
static void fz_load_driver(const char *argv0, const char *name)
{
    char path[4096];
    const char *slash = strrchr(argv0, '/');
    int dirlen = slash ? (int)(slash - argv0) : 1;
    snprintf(path, sizeof(path), "%.*s/%s", dirlen, slash ? argv0 : ".", name);
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "cannot open driver %s\n", path);
        exit(2);
    }
    fseek(f, 0, SEEK_END);
    fz_driver_len = ftell(f);
    fseek(f, 0, SEEK_SET);
    fz_driver_src = malloc(fz_driver_len + 1);
    if (fread(fz_driver_src, 1, fz_driver_len, f) != fz_driver_len)
        exit(2);
    fz_driver_src[fz_driver_len] = 0;
    fclose(f);
    setenv("TZ", "UTC", 1);
}

static double fz_now(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

static int fz_interrupt(JSContext *ctx, void *opaque)
{
    Fuzz *f = opaque;
    return --f->budget < 0 || fz_now() > f->deadline;
}

static Fuzz fz_state;

static void fz_teardown(Fuzz *f)
{
    JS_FreeValue(f->ctx, f->fn);
    JS_FreeContext(f->ctx);
    JS_FreeRuntime(f->rt);   // asserts that no GC object leaked
    f->ctx = NULL;
}

// Returns the shared state, ready to run one input with the given budget.
static Fuzz *fz_begin(int budget)
{
    Fuzz *f = &fz_state;
    static int fresh = -1;
    if (fresh < 0)
        fresh = getenv("FZ_FRESH") != NULL;
    if (f->ctx && (fresh || ++f->uses >= FZ_REUSE))
        fz_teardown(f);
    if (!f->ctx) {
        f->rt = JS_NewRuntime();
        f->ctx = f->rt ? JS_NewContext(f->rt) : NULL;
        if (!f->ctx)
            abort();
        JS_SetInterruptHandler(f->rt, fz_interrupt, f);
        f->budget = 1 << 20;
        f->deadline = fz_now() + 60000;
        f->fn = JS_Eval(f->ctx, fz_driver_src, fz_driver_len, "driver.js", JS_EVAL_TYPE_GLOBAL);
        if (!JS_IsFunction(f->ctx, f->fn)) {
            fprintf(stderr, "driver did not evaluate to a function\n");
            abort();
        }
        f->uses = 0;
    }
    f->budget = budget;
    f->deadline = fz_now() + FZ_WALL_MS;
    return f;
}

// Input bytes to a JS string. A byte below 0xFF is that code unit; 0xFF
// followed by two bytes is the 16-bit code unit they spell. That keeps ASCII
// dictionaries usable while still reaching every code unit, including lone
// surrogates. The string is built the way the engine would build it: narrow
// (8-bit) when every unit fits, wide otherwise.
static JSValue fz_string(JSContext *ctx, const uint8_t *data, size_t len)
{
    static uint16_t units[FZ_MAX_UNITS];
    static char utf8[FZ_MAX_UNITS * 2];
    size_t n = 0, i = 0;
    int wide = 0;
    while (i < len && n < FZ_MAX_UNITS) {
        uint16_t u = data[i++];
        if (u == 0xFF && i + 1 < len) {
            u = (uint16_t)(data[i] << 8 | data[i + 1]);
            i += 2;
        }
        wide |= u > 0xFF;
        units[n++] = u;
    }
    if (wide)
        return JS_NewStringUTF16(ctx, units, n);
    size_t m = 0;
    for (i = 0; i < n; i++) {
        if (units[i] < 0x80) {
            utf8[m++] = (char)units[i];
        } else {
            utf8[m++] = (char)(0xC0 | units[i] >> 6);
            utf8[m++] = (char)(0x80 | (units[i] & 0x3F));
        }
    }
    return JS_NewStringLen(ctx, utf8, m);
}

// Splits data at the first 0x00 byte: [data, *alen) and [*b, *blen).
static void fz_split(const uint8_t *data, size_t len, size_t *alen,
                     const uint8_t **b, size_t *blen)
{
    const uint8_t *z = memchr(data, 0, len);
    if (z) {
        *alen = z - data;
        *b = z + 1;
        *blen = len - *alen - 1;
    } else {
        *alen = len;
        *b = data + len;
        *blen = 0;
    }
}

// Calls the driver with argv. Takes ownership of the argv values.
static void fz_run(Fuzz *f, int argc, JSValue *argv)
{
    JSContext *ctx = f->ctx;
    JSValue ret = JS_Call(ctx, f->fn, JS_UNDEFINED, argc, argv);
    if (JS_IsException(ret)) {
        JSValue exc = JS_GetException(ctx);
        if (JS_IsString(exc)) {
            const char *s = JS_ToCString(ctx, exc);
            if (s && !strncmp(s, "ORACLE", 6)) {
                fprintf(stderr, "%s\n", s);
                abort();
            }
            JS_FreeCString(ctx, s);
        }
        JS_FreeValue(ctx, exc);
    }
    JS_FreeValue(ctx, ret);
    for (int i = 0; i < argc; i++)
        JS_FreeValue(ctx, argv[i]);
}

#endif
