// Strings and Unicode: input is [a] 0x00 [b]. Normalization, case mapping,
// comparison, well-formedness, URI coding, and search methods against naive
// reference implementations.
#include "fuzz-common.h"

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    fz_load_driver((*argv)[0], "fuzz-string.js");
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len)
{
    Fuzz *f = fz_begin(400);
    size_t alen, blen;
    const uint8_t *b;
    fz_split(data, len, &alen, &b, &blen);
    JSValue argv[2];
    argv[0] = fz_string(f->ctx, data, alen);
    argv[1] = fz_string(f->ctx, b, blen);
    fz_run(f, 2, argv);
    return 0;
}
