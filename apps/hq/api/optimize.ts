import { createOptimizeHandler } from '../server/optimize.js';
const handle = createOptimizeHandler();
export default { fetch(request: Request) { return handle(request); } };
