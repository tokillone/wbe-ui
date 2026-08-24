# 全球污水厂地图上线验收清单

## 部署与网络

- [ ] 浏览器地图接口均请求当前站点的 `/api/map/**`，生产包中没有后端主机名或 IP。
- [ ] `/tiles/**` 由 Nginx 静态文件模块直接响应，不进入 `/api/` 或 Spring Boot。
- [ ] `wbe-basemap.pmtiles` 与 `wbe-regions.pmtiles` 的 Range 请求均返回 `206`、正确的
  `Content-Range`、`Content-Length: 127` 和 ETag。
- [ ] 越界 Range 返回 `416`，不会退化成完整瓦片包下载。
- [ ] DevTools Network 中 PMTiles 请求是小体积 Range 请求；没有 63MB/187MB 的整包响应。
- [ ] `/api/map/filters`、`stats`、`detail`、`regions`、点位列表和关联质检接口返回
  `Cache-Control: public` 与 ETag；携带相同 `If-None-Match` 时返回 `304`。
- [ ] `POST /api/map/cluster-detail` 返回 `Cache-Control: no-store`。

## 数据口径与层级

- [ ] 默认“全部”筛选的国家数、省/州数、城市数、点位数、文献数和记录数与上线基线一致。
- [ ] 国家缩放层级可选中国、美国及至少一个其他国家，并能打开国家详情。
- [ ] 省/州缩放层级可选中国省份和非中国省/州，并能打开省/州详情。
- [ ] 城市缩放层级可选中国城市和有城市数据的海外城市，并能打开城市详情。
- [ ] 地图点位数仍按 `record_site_bridge.effective_site_key` 去重；未改变报告点位纳入规则。
- [ ] `confirmed_site_id` 仍仅遵循现有人工确认/关联逻辑，没有新增自动跨文献合并。
- [ ] 点位详情中的报告名称、文献标识、关联状态、覆盖记录及来源记录相互一致。

## 筛选、PNDL 与趋势

- [ ] 目标类别、物质类别、小类、标记物和年份逐级筛选均只发起一次最终统计请求。
- [ ] 选择具体标记物后，国家、省/州、城市热度与气泡同步更新。
- [ ] PNDL 图例、详情当前值和横向排名均使用 `mg/day/1000 inh` 的既有中位数口径。
- [ ] 国家、省/州、城市的 PNDL 比较范围与当前层级一致，当前选中项高亮正确。
- [ ] 年度趋势只合并同单位数据，节点展示年度中位数和数据行数；少于两年时显示无趋势数据。
- [ ] “全部标记物”不会混合不同物质的 PNDL 值，也不会错误显示趋势/横向比较。

## 降级、空态与性能

- [ ] 后端接口断开或返回 5xx 时，页面显示地图接口失败提示，不静默覆盖为“无数据”。
- [ ] 任一 PMTiles Range 请求失败时，页面提示“部分瓦片加载失败”，并保留可用本地边界/底图。
- [ ] 空筛选结果显示可操作的空态提示，已有地图控件仍可使用。
- [ ] 筛选快速连续切换时旧请求被取消，最终只渲染最后一次选择。
- [ ] 常规非空 `stats`/`filters` 请求不执行昂贵的全库诊断计数；诊断 SQL 仅在空结果时运行。
- [ ] 生产环境单条 MyBatis 查询受 `DB_QUERY_TIMEOUT_SECONDS` 限制，默认 30 秒。
- [ ] 使用浏览器 Network 或下列命令记录压缩后响应体积和耗时，并与上线基线比较：

```sh
curl -fsS --compressed -o /dev/null \
  -w 'status=%{http_code} bytes=%{size_download} total=%{time_total}s\n' \
  'https://YOUR_HOST/api/map/stats?targetClass=ALL&category=%E5%85%A8%E9%83%A8%E7%9B%AE%E6%A0%87%E7%89%A9%E8%B4%A8%E7%B1%BB%E5%88%AB&subcategory=%E5%85%A8%E9%83%A8%E5%B0%8F%E7%B1%BB&biomarkerKey=ALL&year=%E5%85%A8%E9%83%A8%E5%B9%B4%E4%BB%BD&levels=country%2Cadmin1%2Ccity'
```

## 自动化验证

- [ ] `npm run test:unit -- --run src/__tests__/mapVisualization.spec.ts src/__tests__/mapNetwork.spec.ts`
- [ ] `npm run type-check`
- [ ] `./mvnw -Dtest=MapVisualizationServiceImplTest,MapVisualizationControllerCacheTest test`
- [ ] `./mvnw test`
