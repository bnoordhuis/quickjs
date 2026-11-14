import { get } from './shared.js';
import { b } from './dep.js';
let m = 0;
export const g = () => m + get() + b;
