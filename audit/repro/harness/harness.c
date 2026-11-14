// Runs a script with an interrupt handler that fires after DEADLINE ms.
// Prints how the script ended and how long it took.
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "quickjs.h"

static double now_ms(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}
static double start, deadline;
static int interrupt(JSContext *ctx, void *opaque) { return now_ms() - start > deadline; }

int main(int argc, char **argv) {
    if (argc < 3) return 2;
    deadline = atof(argv[2]);
    FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
    static char buf[1 << 20]; size_t n = fread(buf, 1, sizeof(buf) - 1, f); buf[n] = 0; fclose(f);
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    JS_SetInterruptHandler(rt, interrupt, NULL);
    start = now_ms();
    JSValue v = JS_Eval(ctx, buf, n, argv[1], JS_EVAL_TYPE_GLOBAL);
    const char *how = JS_IsException(v) ? "exception" : "completed";
    if (JS_IsException(v)) { JSValue e = JS_GetException(ctx); const char *s = JS_ToCString(ctx, e);
        printf("%s: %s", how, s ? s : "?"); JS_FreeCString(ctx, s); JS_FreeValue(ctx, e); }
    else printf("%s", how);
    printf(" after %.0f ms\n", now_ms() - start);
    JS_FreeValue(ctx, v);
    return 0;  // skip runtime teardown: not what is being measured
}
