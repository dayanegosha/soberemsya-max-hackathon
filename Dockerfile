FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY data ./data
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/var/soberemsya.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/bot ./apps/bot
COPY --from=build /app/packages ./packages
COPY --from=build /app/data ./data
COPY certs ./certs
COPY --from=build /app/dist ./dist
RUN mkdir /app/var && chown node:node /app/var
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--import","tsx","apps/server/src/index.ts"]
