const r = await Promise.allSettled([import('./shared.js'), import('./main3.js'), import('./mid.js')]);
print(r.map(x => x.status + ':' + String(x.reason)).join(' | '));
