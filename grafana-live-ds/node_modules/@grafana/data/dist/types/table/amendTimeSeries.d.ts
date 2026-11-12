export type Table = [times: number[], ...values: any[][]];
export declare function amendTable(prevTable: Table, nextTable: Table): Table;
export declare function trimTable(table: Table, fromTime: number, toTime: number): Table;
