import { createStewardHandler } from '../server/steward.js';
// Vercel Cron sends GET with `Authorization: Bearer ${CRON_SECRET}`.
export default { fetch(request: Request) { return createStewardHandler(process.env)(request); } };
