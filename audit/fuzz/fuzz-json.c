// JSON: input is the text to parse.
#include "fuzz-common.h"

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    fz_load_driver((*argv)[0], "fuzz-json.js");
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len)
{
    Fuzz *f = fz_begin(200);
    JSValue argv[1];
    argv[0] = fz_string(f->ctx, data, len);
    fz_run(f, 1, argv);
    return 0;
}
