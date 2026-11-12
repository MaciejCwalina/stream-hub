/**
 * @beta
 * Proxies a ES6 class so that it can be used as a base class for an ES5 class
 */
export declare function makeClassES5Compatible<T extends abstract new (...args: ConstructorParameters<T>) => InstanceType<T>>(ES6Class: T): T;
