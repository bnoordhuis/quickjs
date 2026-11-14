// BigInt ** overflowing the size limit must not leak the partial result
for (let i = 0; i < 20; i++) { try { 3n ** 2000000n; } catch (e) { if (i == 0) print(e); } }
