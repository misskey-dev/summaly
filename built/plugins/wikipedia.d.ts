/// <reference types="node" />
import { URL } from 'node:url';
import summary from '../summary.js';
export declare function test(url: URL): boolean;
export declare function summarize(url: URL): Promise<summary>;
