// Date. Input byte 0 selects the mode:
//   even: the rest is a string for Date.parse()
//   odd:  up to seven doubles for the Date constructor, Date.UTC and one setter
//         (chosen by the remaining bits of byte 0)
// The process runs with TZ=UTC so results do not depend on the host.
#include "fuzz-common.h"

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    fz_load_driver((*argv)[0], "fuzz-date.js");
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len)
{
    if (len < 2)
        return 0;
    Fuzz *f = fz_begin(200);
    JSValue argv[3];
    argv[2] = JS_NewInt32(f->ctx, data[0] >> 1);
    if (data[0] & 1) {
        double v[7] = { 0 };
        size_t n = (len - 1) / 8;
        if (n > 7)
            n = 7;
        memcpy(v, data + 1, n * 8);
        argv[0] = JS_UNDEFINED;
        argv[1] = JS_NewArray(f->ctx);
        for (size_t i = 0; i < n; i++)
            JS_SetPropertyUint32(f->ctx, argv[1], i, JS_NewFloat64(f->ctx, v[i]));
    } else {
        argv[0] = fz_string(f->ctx, data + 1, len - 1);
        argv[1] = JS_UNDEFINED;
    }
    fz_run(f, 3, argv);
    return 0;
}
