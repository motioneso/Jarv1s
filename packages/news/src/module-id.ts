// Lives apart from manifest.ts so runtime modules (jobs.ts) can use the id without
// importing the manifest — manifest.ts imports the chat tools, whose helpers reach
// jobs.ts, and a manifest←jobs import would close an ESM cycle that leaves the
// manifest's `execute` bindings undefined at evaluation time (#975 Slice 4).
export const NEWS_MODULE_ID = "news";
