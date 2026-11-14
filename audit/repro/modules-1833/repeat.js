const r = await Promise.allSettled([import('./main3.js'), import('./main3.js')]);
print(r.map(x => x.status + ':' + String(x.reason)).join(' | '));
