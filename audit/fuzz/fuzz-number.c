// Number conversion. Input byte 0 selects the mode:
//   even: the rest is a string for Number(), parseFloat(), parseInt(), BigInt()
//   odd:  8 bytes of a double, then a radix byte, for the formatting methods
// The C library's strtod/printf are the reference for decimal conversions.
#include <math.h>
#include "fuzz-common.h"

// c_strtod(string) -> number, using the C library
static JSValue c_strtod(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *s = JS_ToCString(ctx, argv[0]);
    if (!s)
        return JS_EXCEPTION;
    double d = strtod(s, NULL);
    JS_FreeCString(ctx, s);
    return JS_NewFloat64(ctx, d);
}

// c_shortest(number) -> the correctly rounded "%.<p>e" text with the smallest p
// that converts back to the same double, in JS exponent style ("1.5e+3").
static JSValue c_shortest(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double d;
    char buf[64], out[64];
    if (JS_ToFloat64(ctx, &d, argv[0]))
        return JS_EXCEPTION;
    if (!isfinite(d))
        return JS_NewString(ctx, "");
    for (int p = 0; p <= 17; p++) {
        snprintf(buf, sizeof(buf), "%.*e", p, d);
        if (strtod(buf, NULL) == d)
            break;
    }
    char *e = strchr(buf, 'e');
    int expn = atoi(e + 1);
    snprintf(out, sizeof(out), "%.*se%c%d", (int)(e - buf), buf, expn < 0 ? '-' : '+', abs(expn));
    return JS_NewString(ctx, out);
}

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    fz_load_driver((*argv)[0], "fuzz-number.js");
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len)
{
    if (len < 2)
        return 0;
    Fuzz *f = fz_begin(200);
    JSValue argv[5];
    if (data[0] & 1) {
        double d = 0;
        uint8_t raw[8] = { 0 };
        memcpy(raw, data + 1, len - 1 < 8 ? len - 1 : 8);
        memcpy(&d, raw, 8);
        argv[0] = JS_UNDEFINED;
        argv[1] = JS_NewFloat64(f->ctx, d);
        argv[2] = JS_NewInt32(f->ctx, len > 9 ? 2 + data[9] % 35 : 10);
    } else {
        argv[0] = fz_string(f->ctx, data + 1, len - 1);
        argv[1] = JS_UNDEFINED;
        argv[2] = JS_UNDEFINED;
    }
    argv[3] = JS_NewCFunction(f->ctx, c_strtod, "c_strtod", 1);
    argv[4] = JS_NewCFunction(f->ctx, c_shortest, "c_shortest", 1);
    fz_run(f, 5, argv);
    return 0;
}
