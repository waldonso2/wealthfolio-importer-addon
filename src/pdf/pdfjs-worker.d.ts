// pdf.js ships no types for its worker module; text.ts only hands the module
// object to pdf.js (globalThis.pdfjsWorker).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
