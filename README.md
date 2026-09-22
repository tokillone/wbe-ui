# wbe-ui

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

本项目的标准本地入口为 `http://127.0.0.1:5173`，开发环境默认通过 Vite 代理连接后端 `http://127.0.0.1:8080`。先启动后端，再启动前端；修改 `.env.local` 后必须重启 Vite。

```sh
# 终端 1：在 wbe-backup 中启动当前后端（默认 8080）
./mvnw spring-boot:run

# 终端 2：在 wbe-ui 中启动前端（5173）
npm run dev

# 终端 3：确认 5173 已返回 keywords 字段和真实因子数量
npm run dev:check
```

若自检返回 HTTP 502，说明 Vite 连接不到代理目标。先用 `curl http://127.0.0.1:8080/actuator/health` 确认后端为 `UP`，再确认 `.env.local` 没有把 `WBE_DEV_PROXY_TARGET` 覆盖成其他端口；修正为 `http://127.0.0.1:8080` 后重启前端。若自检提示“响应缺少 keywords”，说明 5173 连接的不是当前后端。

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

## 上线与环境搭建

前端、后端、MySQL 的已有环境发布、从零搭建、备份、恢复、回滚和命令说明见 [上线与环境搭建手册](docs/%E4%B8%8A%E7%BA%BF%E4%B8%8E%E7%8E%AF%E5%A2%83%E6%90%AD%E5%BB%BA%E6%89%8B%E5%86%8C.md)。

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
