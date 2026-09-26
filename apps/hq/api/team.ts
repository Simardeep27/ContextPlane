import { createTeamHandler } from '../server/team.js';
export default { fetch(request: Request) { return createTeamHandler(process.env)(request); } };
