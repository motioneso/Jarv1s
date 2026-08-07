// HttpError is consolidated in @moss/module-sdk so the shared handleRouteError's
// `instanceof HttpError` check works across modules. Re-exported here to preserve
// the existing `./errors.js` import path used by this module's routes and repository.
export { HttpError } from "@moss/module-sdk";
