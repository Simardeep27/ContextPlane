import { createChatHandler } from '../server/chat.js';
export default { fetch(request: Request) { return createChatHandler(process.env)(request); } };
