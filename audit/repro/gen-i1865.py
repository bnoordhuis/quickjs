# Writes i1865.js (issue #1865): a generator that captures 65535 variables,
# overflowing the 16-bit captured-variable count. Run: python3 -I gen-i1865.py
from pathlib import Path
a = ",".join(f"a{i}" for i in range(32768))
v = ",".join(f"v{i}" for i in range(32767))
refs = ";".join([f"a{i}" for i in range(32768)] + [f"v{i}" for i in range(32767)])
Path("i1865.js").write_text(
    f"function* g({a}){{\n  {{ let x=1; if (Math.random()<0) (()=>x); }}\n  var {v};\n"
    f"  if (Math.random()<0) (()=>{{{refs}}});\n  yield 1;\n}}\nvar it=g(); it.next();\n")
