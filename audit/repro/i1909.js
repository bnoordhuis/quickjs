var A = [], B = [];
for (var i = 0; i < 33000; i++) A.push("a" + i);
for (var i = 0; i < 32535; i++) B.push("b" + i);
var src =
  "(function G() {\n  eval('');\n  return function g(" + A.join(",") + ") {\n" +
  "    return function outer(" + B.join(",") + ") {\n      return function inner() {\n" +
  "        " + A.join(";") + ";\n        " + B.join(";") + ";\n        return typeof zzz;\n" +
  "      };\n    };\n  };\n})";
var G = (0, eval)(src);
var inner = G()()();
inner();
