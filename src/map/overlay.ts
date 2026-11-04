/**
 * DOM elements for labels and orbit markers, drawn in a plain HTML layer over the canvas.
 * The scene's frame loop positions them directly (no React re-render per frame).
 */
export const labelElements = new Map<string, HTMLDivElement>();
export const markerElements = new Map<string, HTMLDivElement>();
