/**
 * @internal
 */
export declare function getCanvasContext(): CanvasRenderingContext2D;
/**
 * @beta
 */
export declare function measureText(text: string, fontSize: number, fontWeight?: number): TextMetrics;
/**
 * @beta
 */
export declare function calculateFontSize(text: string, width: number, height: number, lineHeight: number, maxSize?: number, fontWeight?: number): number;
