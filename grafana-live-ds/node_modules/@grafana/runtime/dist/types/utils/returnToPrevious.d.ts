type ReturnToPreviousHook = () => (title: string, href?: string) => void;
export declare const setReturnToPreviousHook: (hook: ReturnToPreviousHook) => void;
/**
 * Guidelines:
 * - Only use the ‘Return to previous’ functionality when the user is sent to another context, such as from Alerting to a dashboard.
 * - Specify a button title that identifies the page to return to in the most understandable way. Do not use text such as ‘Back to the previous page’. Be specific.
 */
export declare const useReturnToPrevious: ReturnToPreviousHook;
export {};
