import { createTeamHandler } from '../server/team.ts';
export default { fetch(request: Request) { return createTeamHandler(process.env)(request); } };
