import { IPlugin } from '@/iplugin.js';
import * as amazon from './amazon.js';
import * as wikipedia from './wikipedia.js';
import * as branchIoDeeplinks from './branchio-deeplinks.js';

export const plugins: IPlugin[] = [
    amazon,
    wikipedia,
    branchIoDeeplinks,
];
