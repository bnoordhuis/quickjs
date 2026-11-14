// RegExp: input is [flags byte][pattern] 0x00 [subject].
#include "fuzz-common.h"

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    fz_load_driver((*argv)[0], "fuzz-regexp.js");
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t len)
{
    if (len < 2)
        return 0;
    Fuzz *f = fz_begin(200);
    uint8_t bits = data[0];
    char flags[8];
    int n = 0;
    if (bits & 1) flags[n++] = 'd';
    if (bits & 2) flags[n++] = 'g';
    if (bits & 4) flags[n++] = 'i';
    if (bits & 8) flags[n++] = 'm';
    if (bits & 16) flags[n++] = 's';
    if (bits & 32) flags[n++] = 'y';
    if ((bits >> 6) == 1) flags[n++] = 'u';
    if ((bits >> 6) == 2) flags[n++] = 'v';
    flags[n] = 0;
    size_t plen, slen;
    const uint8_t *subj;
    fz_split(data + 1, len - 1, &plen, &subj, &slen);
    JSValue argv[3];
    argv[0] = fz_string(f->ctx, data + 1, plen);
    argv[1] = JS_NewString(f->ctx, flags);
    argv[2] = fz_string(f->ctx, subj, slen);
    fz_run(f, 3, argv);
    return 0;
}
