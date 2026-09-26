import { createEvaluatorHandler } from '../server/evaluator.js';
const handler=createEvaluatorHandler(process.env);
export default { fetch(request:Request){return handler(request);} };
