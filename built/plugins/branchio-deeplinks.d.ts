/// <reference types="node" />
import { URL } from 'node:url';
import Summary from '../summary.js';
export declare function test(url: URL): boolean;
export declare function summarize(url: URL, lang?: string | null): Promise<Summary | null>;
