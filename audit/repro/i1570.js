async function main() {
    const iterable = {};
    function asyncIter() {
        async function* g() { return g; }
        Object.defineProperty(g, "then", { configurable: true, value: asyncIter });
        const it = g();
        it.next();
        return it;
    }
    iterable[Symbol.asyncIterator] = asyncIter;
    for await (using r of iterable) {}
}
main();
