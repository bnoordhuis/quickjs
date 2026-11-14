let s = 1;
export function get() { return s; }
export let live = 2;
export const touch = () => { s += live; return s; };
