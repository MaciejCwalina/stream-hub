export interface RenderMarkdownOptions {
    noSanitize?: boolean;
    breaks?: boolean;
}
export declare function renderMarkdown(str?: string, options?: RenderMarkdownOptions): string;
export declare function renderTextPanelMarkdown(str?: string, options?: RenderMarkdownOptions): string;
