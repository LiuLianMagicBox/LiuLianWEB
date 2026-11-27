FROM node:22-bookworm-slim AS build
WORKDIR /app/website-part
COPY website-part/package*.json ./
RUN npm ci
COPY website-part/ ./
COPY shared/ /app/shared/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production BIND_IP=0.0.0.0 PORT=3000
WORKDIR /app/website-part
COPY --from=build --chown=node:node /app/website-part/package*.json ./
COPY --from=build --chown=node:node /app/website-part/node_modules ./node_modules
COPY --from=build --chown=node:node /app/website-part/src ./src
COPY --from=build --chown=node:node /app/website-part/frontend/src/lib/rdp ./frontend/src/lib/rdp
COPY --from=build --chown=node:node /app/website-part/public ./public
COPY --from=build --chown=node:node /app/shared /app/shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=150s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
