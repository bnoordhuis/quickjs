// Embedder frees the runtime while a module's top-level await is pending.
#include <stdio.h>
#include <string.h>
#include "quickjs.h"
int main(void) {
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    const char *src = "globalThis.p = new Promise(() => {}); await globalThis.p;";
    JSContext *jctx; JSValue v = JS_Eval(ctx, src, strlen(src), "tla.mjs", JS_EVAL_TYPE_MODULE);
    printf("eval returned %s\n", JS_IsException(v) ? "exception" : "promise");
    JS_FreeValue(ctx, v);
    while (JS_ExecutePendingJob(rt, &jctx) > 0) {}
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    printf("teardown done\n");
    return 0;
}
