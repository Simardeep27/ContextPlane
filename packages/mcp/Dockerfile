FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/persistence/package.json ./packages/persistence/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/mcp-worker/package.json ./packages/mcp-worker/package.json
RUN npm ci --ignore-scripts
COPY packages/contracts ./packages/contracts
COPY packages/persistence ./packages/persistence
COPY packages/mcp ./packages/mcp
RUN npm run build -w @context-plane/contracts && npm run build -w @context-plane/mcp
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8010
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/persistence/package.json ./packages/persistence/package.json
COPY --from=build /app/packages/persistence/dist ./packages/persistence/dist
COPY --from=build /app/packages/mcp/package.json ./packages/mcp/package.json
COPY --from=build /app/packages/mcp/dist ./packages/mcp/dist
USER node
EXPOSE 8010
CMD ["node", "packages/mcp/dist/main.js"]
