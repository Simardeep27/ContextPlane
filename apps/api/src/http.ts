import type { ImpactResult } from "@context-plane/persistence";
import { ApiError, ContextApi, type PublishDependencyInput } from "./context-api.js";
import { optimizeHarnessPrompt, parseHarnessOptimizeInput } from "./harness-optimize.js";

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function parseJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new ApiError(400, "REQUEST_TOO_LARGE");
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

/** Read-only transitive impact reader (`$graphLookup` over coordination dependencies). */
export type ImpactReader = (projectId: string, coordinationScope: string, surface: string) => Promise<ImpactResult>;

export function createContextApiHandler(api: ContextApi, impact?: ImpactReader): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/harness-optimize") {
        if (request.method !== "POST") throw new ApiError(404, "ROUTE_NOT_FOUND");
        api.authenticate(request.headers.get("x-demo-session"));
        let body: unknown;
        try {
          body = await parseJson(request);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(400, "INVALID_INPUT");
        }
        try {
          return json(200, optimizeHarnessPrompt(parseHarnessOptimizeInput(body)));
        } catch (error) {
          if (error instanceof TypeError && error.message === "INVALID_INPUT") {
            throw new ApiError(400, "INVALID_INPUT");
          }
          throw error;
        }
      }
      const match = /^\/v1\/projects\/([^/]+)\/(context|projection|events|impact|publications\/dev-b)$/u.exec(url.pathname);
      if (!match) throw new ApiError(404, "ROUTE_NOT_FOUND");
      const projectId = decodeURIComponent(match[1] ?? "");
      const route = match[2];
      const identity = api.authenticate(request.headers.get("x-demo-session"));
      if (request.method === "GET" && route === "context") {
        return json(200, await api.getContext(identity, projectId, url.searchParams.get("agentId") ?? undefined));
      }
      if (request.method === "GET" && route === "impact") {
        if (!impact) throw new ApiError(404, "ROUTE_NOT_FOUND");
        const scope = url.searchParams.get("scope") ?? ""; const surface = url.searchParams.get("surface") ?? "";
        if (!scope || !surface || scope.length > 256 || surface.length > 256) throw new ApiError(400, "INVALID_INPUT");
        return json(200, { source: "live", ...await impact(projectId, scope, surface) });
      }
      if (request.method === "GET" && route === "projection") {
        return json(200, await api.getProjection(identity, projectId));
      }
      if (request.method === "GET" && route === "events") {
        return json(200, { events: await api.getEvents(identity, projectId, url.searchParams.get("after") ?? undefined) });
      }
      if (request.method === "POST" && route === "publications/dev-b") {
        const result = await api.publishDependency(identity, projectId, await parseJson(request) as PublishDependencyInput);
        return json(result.replayed ? 200 : 201, result);
      }
      throw new ApiError(404, "ROUTE_NOT_FOUND");
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: { code: error.code } });
      return json(500, { error: { code: "INTERNAL_ERROR" } });
    }
  };
}
