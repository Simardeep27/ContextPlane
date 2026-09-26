import { createServer } from "node:http";

import { connectStorage, DurablePersistenceAdapter } from "@context-plane/persistence";

import { ContextApi } from "./context-api.js";
import { createContextApiHandler } from "./http.js";

const database = process.env.CONTEXT_PLANE_DATABASE ?? "context_plane_poc";
const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");

const connection = await connectStorage(database);
await connection.storage.initialize();
const api = new ContextApi(new DurablePersistenceAdapter(connection.storage));
await api.initialize();
const handle = createContextApiHandler(api);

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
      method: incoming.method ?? "GET",
      headers: incoming.headers as HeadersInit,
      ...(body.length === 0 ? {} : { body }),
    });
    const response = await handle(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 400;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ error: { code: "INVALID_REQUEST" } }));
  }
});

server.listen(port, () => process.stdout.write(`Context API listening on :${port}\n`));

async function shutdown(): Promise<void> {
  server.close();
  await connection.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
