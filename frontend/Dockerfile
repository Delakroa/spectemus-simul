FROM node:24.18.0-alpine3.23 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@11.10.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY poc/media-capture-livekit/package.json poc/media-capture-livekit/package.json

RUN pnpm install --frozen-lockfile --filter @watch-together/frontend...

COPY frontend frontend

ARG VITE_API_BASE_URL=
ARG VITE_LIVEKIT_URL=ws://127.0.0.1:7880

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL

RUN pnpm --filter @watch-together/frontend build

FROM nginx:1.31.1-alpine3.23

# security-headers.conf is rendered from a template at start-up: the nginx entrypoint runs
# envsubst over /etc/nginx/templates/*.template into NGINX_ENVSUBST_OUTPUT_DIR. WT_CSP_CONNECT_SRC
# defaults to the dev value here and can be overridden per deployment to narrow CSP connect-src.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
ENV WT_CSP_CONNECT_SRC="'self' ws: wss:"

COPY infra/nginx/security-headers.conf.template /etc/nginx/templates/security-headers.conf.template
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=10 \
  CMD wget -qO- http://127.0.0.1/gateway-health | grep -q '^ok$'
