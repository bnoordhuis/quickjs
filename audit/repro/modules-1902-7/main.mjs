try { await import("./a.mjs"); } catch (e) { print("a failed:", e.message); }
try { const m = await import("./b.mjs"); print("b loaded", m.b); } catch (e) { print("b failed:", e.message); }
