/**
 * mutates all nulls -> undefineds in the fieldValues array for value-less refValues ranges below maxThreshold
 * refValues is typically a time array and maxThreshold is the allowable distance between in time
 * @deprecated
 */
export declare function nullToUndefThreshold(refValues: number[], fieldValues: any[], maxThreshold: number): any[];
