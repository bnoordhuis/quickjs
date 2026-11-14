// truncating a slow array must delete every index >= new length
var a = [];
for (var i = 0; i < 200; i++) a[1000 + i * 2] = i;
a.length = 0;
print(JSON.stringify({ length: a.length, remainingKeys: Object.keys(a).length }));
