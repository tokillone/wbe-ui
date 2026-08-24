# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_ENABLE_HOME_OVERVIEW_API=true
ENV VITE_ENABLE_HOME_OVERVIEW_API=${VITE_ENABLE_HOME_OVERVIEW_API}
RUN npm run build

FROM nginx:1.28-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/proxy-headers.conf /etc/nginx/snippets/proxy-headers.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
