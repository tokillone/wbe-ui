<script setup lang="ts">
import { RouterLink } from 'vue-router'

import PlatformHeader from '../components/PlatformHeader.vue'
import AcademicFooter from '../components/academic/AcademicFooter.vue'

const modules = [
  {
    id: 'guide-map',
    title: '空间分布查询',
    route: '/map-visualization',
    image: '/academic-home/screens/map-interface.webp?v=20260901',
    alt: '空间分布查询界面，显示中国范围地图和空间研究点位',
    steps: [
      ['限定检索范围', '先选择目标物质、时间或空间层级，避免在全球数据中反复缩放。'],
      ['打开区域', '从国家进入地区或城市，查看点位及人群归一化负荷。'],
      ['调整地图表达', '按研究目的切换标记、标签和底图显示，再读取点位详情。'],
    ],
    markers: [
      { x: '18%', y: '34%', label: '1' },
      { x: '50%', y: '47%', label: '2' },
      { x: '94%', y: '20%', label: '3' },
    ],
  },
  {
    id: 'guide-disease',
    title: '疾病关联分析',
    route: '/icd11-sankey',
    image: '/academic-home/screens/sankey-interface.webp?v=20260901',
    alt: '疾病关联分析界面，显示 ICD-11 层级桑基图和侧栏',
    steps: [
      ['搜索节点', '输入疾病、药物或标记物名称，快速定位对应证据节点。'],
      ['筛选路径', '按节点层级和关联方向缩小关系范围。'],
      ['锁定关系', '读取流向和连线权重，锁定需要继续核验的证据链。'],
      ['查看详情', '打开侧栏核对 Top 7 与其他的完整构成，并查看按药物数计算的处方比例。'],
      ['图表与导出', '在图表说明中核对口径，再导出当前分析结果。'],
    ],
    markers: [
      { x: '20%', y: '14%', label: '1' },
      { x: '50%', y: '43%', label: '2' },
      { x: '86%', y: '35%', label: '3' },
    ],
  },
  {
    id: 'guide-priority',
    title: '标记物优先级评估',
    route: '/core-marker-priority',
    image: '/academic-home/screens/priority-interface.webp?v=20260901',
    alt: '标记物优先级评估真实界面，显示分层筛选和证据评分',
    steps: [
      ['全局检索', '用标记物或类别名称进入目标证据集合。'],
      ['四级筛选', '依次限定目标类型、类别、子类与具体标记物。'],
      ['下钻分组', '点击横向分组条查看更具体的证据组成。'],
      ['调整排序', '切换排名和展示方式，识别高优先级与证据缺口。'],
      ['核对证据', '查看评分维度、来源文献和当前证据说明。'],
    ],
    markers: [
      { x: '15%', y: '20%', label: '1' },
      { x: '42%', y: '42%', label: '2' },
      { x: '84%', y: '56%', label: '3' },
    ],
  },

]

const faq = [
  ['药物饼图与处方比例为什么不同？', '药物构成饼图按路径权重展示研究覆盖；处方比例按当前范围的去重药物数计算，包含其他药物，属性冲突与未知单独标注。'],
  ['未登录可以使用哪些功能？', '访客可以浏览公开首页、使用说明、关于信息及开放的分析入口。数据维护、审核和同步能力依据账号权限开放。'],
  ['筛选后的数字代表什么？', '页面会明确标注按文献、文献与方法组合或数据行统计。比较前请先确认当前统计口径。'],
  ['如何导出结果？', '进入具体分析工具后，使用页面内提供的导出或下载入口。若入口不可用，通常与当前账号权限或数据状态有关。'],
]
</script>

<template>
  <main class="guide-page">
    <PlatformHeader variant="academic" />

    <section id="main-content" class="guide-hero" tabindex="-1">
      <p>平台使用说明</p>
      <h1>从检索问题出发，完成一次可追溯的证据分析</h1>
      <span>先确认统计口径，再筛选范围、读取关系并回到文献或方法明细核验。</span>
      <nav aria-label="使用说明章节">
        <a v-for="item in modules" :key="item.id" :href="`#${item.id}`">{{ item.title }}</a>
      </nav>
    </section>

    <section class="guide-basics" aria-labelledby="guideBasicsTitle">
      <h2 id="guideBasicsTitle">通用工作流程</h2>
      <ol>
        <li><strong>提出问题</strong><span>明确空间、疾病或标记物中的主问题。</span></li>
        <li><strong>确认口径</strong><span>辨认当前指标按文献、组合或数据行计算。</span></li>
        <li><strong>逐层筛选</strong><span>从较宽范围开始，逐层收窄，保留可解释的筛选路径。</span></li>
        <li><strong>回到证据</strong><span>用详情、来源文献和方法字段核对可比性。</span></li>
      </ol>
    </section>

    <section class="guide-modules" aria-label="三个分析模块的使用步骤">
      <article v-for="module in modules" :id="module.id" :key="module.id" class="guide-module">
        <header>
          <h2>{{ module.title }}</h2>
          <RouterLink :to="module.route">进入工具</RouterLink>
        </header>
        <div class="guide-module-grid">
          <figure>
            <img :src="module.image" :alt="module.alt" width="1320" height="742" loading="lazy" />
            <span
              v-for="marker in module.markers"
              :key="marker.label"
              class="guide-marker"
              :style="{ left: marker.x, top: marker.y }"
              aria-hidden="true"
            >{{ marker.label }}</span>
          </figure>
          <ol>
            <li v-for="(step, index) in module.steps" :key="step[0]">
              <span>{{ index + 1 }}</span>
              <div><strong>{{ step[0] }}</strong><p>{{ step[1] }}</p></div>
            </li>
          </ol>
        </div>
      </article>
    </section>

    <section class="guide-permissions" aria-labelledby="permissionsTitle">
      <div>
        <h2 id="permissionsTitle">权限与数据状态</h2>
        <p>访客可以完成公开检索与分析；登录后根据角色获得数据下载、维护、审核或同步能力。</p>
      </div>
      <dl>
        <div><dt>访客</dt><dd>公开检索、图谱浏览、使用说明</dd></div>
        <div><dt>研究用户</dt><dd>账号授权范围内的数据能力</dd></div>
        <div><dt>数据维护员</dt><dd>数据录入、校验与版本维护</dd></div>
        <div><dt>系统管理员</dt><dd>系统配置、数据维护与审核</dd></div>
      </dl>
    </section>

    <section class="guide-faq" aria-labelledby="faqTitle">
      <h2 id="faqTitle">常见问题</h2>
      <div>
        <details v-for="item in faq" :key="item[0]">
          <summary>{{ item[0] }}</summary>
          <p>{{ item[1] }}</p>
        </details>
      </div>
    </section>

    <AcademicFooter />
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  color: #0b1f33;
  background: #ffffff;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.guide-page {
  min-height: 100dvh;
  color: #0b1f33;
  background: #ffffff;
}

.guide-hero,
.guide-basics,
.guide-modules,
.guide-permissions,
.guide-faq {
  max-width: 1340px;
  margin: 0 auto;
  padding-inline: clamp(22px, 4.5vw, 68px);
}

.guide-hero {
  padding-top: clamp(50px, 6vw, 76px);
  padding-bottom: clamp(56px, 7vw, 82px);
}

.guide-hero > p {
  margin: 0 0 16px;
  color: #1263a8;
  font-size: 13px;
  font-weight: 700;
}

.guide-hero h1 {
  max-width: 15em;
  margin: 0;
  font-size: clamp(38px, 4.6vw, 60px);
  font-weight: 680;
  letter-spacing: -0.05em;
  line-height: 1.1;
  text-wrap: balance;
}

.guide-hero > span {
  max-width: 48em;
  display: block;
  margin-top: 30px;
  color: #56697a;
  font-size: 17px;
  line-height: 1.72;
}

.guide-hero nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 36px;
}

.guide-hero nav a,
.guide-module header a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 0 17px;
  border: 1px solid #1263a8;
  border-radius: 9px;
  color: #1263a8;
  font-size: 13px;
  font-weight: 680;
  text-decoration: none;
}

.guide-hero nav a:hover,
.guide-hero nav a:focus-visible,
.guide-module header a:hover,
.guide-module header a:focus-visible {
  color: #f9fbfd;
  background: #1263a8;
  outline: 3px solid rgba(23, 104, 176, 0.2);
  outline-offset: 2px;
}

.guide-basics {
  display: grid;
  grid-template-columns: minmax(250px, 0.72fr) minmax(0, 1.28fr);
  gap: 64px;
  padding-top: 70px;
  padding-bottom: 90px;
  border-top: 1px solid #d7e0e6;
}

.guide-basics h2,
.guide-permissions h2,
.guide-faq h2 {
  margin: 0;
  font-size: clamp(30px, 3.5vw, 48px);
  letter-spacing: -0.045em;
}

.guide-basics ol {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 34px 48px;
  padding: 0;
  list-style: none;
}

.guide-basics li {
  padding-top: 14px;
  border-top: 1px solid #c7d3d8;
}

.guide-basics li strong,
.guide-basics li span {
  display: block;
}

.guide-basics li strong {
  font-size: 17px;
}

.guide-basics li span {
  margin-top: 8px;
  color: #56697a;
  line-height: 1.7;
}

.guide-module {
  padding: 80px 0 96px;
  scroll-margin-top: 92px;
  border-top: 1px solid #d7e0e6;
}

.guide-module header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 34px;
}

.guide-module header h2 {
  margin: 0;
  font-size: clamp(32px, 4vw, 56px);
  letter-spacing: -0.05em;
}

.guide-module-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(330px, 0.6fr);
  gap: 44px;
  align-items: start;
}

.guide-module figure {
  position: relative;
  margin: 0;
  overflow: hidden;
  border: 1px solid #cbd7df;
  border-radius: 10px;
  background: #f6f9fc;
  box-shadow: none;
}

.guide-module figure img {
  width: 100%;
  height: auto;
  display: block;
}

.guide-marker {
  position: absolute;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 3px solid #ffffff;
  border-radius: 50%;
  color: #f9fbfd;
  background: #1263a8;
  box-shadow: 0 6px 18px rgba(16, 43, 70, 0.22);
  font-weight: 800;
}

.guide-module-grid > ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-module-grid > ol li {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 14px;
  padding: 18px 0;
  border-bottom: 1px solid #d7e0e6;
}

.guide-module-grid > ol li > span {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid #1263a8;
  border-radius: 50%;
  color: #1263a8;
  font-weight: 760;
}

.guide-module-grid strong {
  font-size: 16px;
}

.guide-module-grid p {
  margin: 7px 0 0;
  color: #56697a;
  font-size: 14px;
  line-height: 1.65;
}

.guide-permissions {
  display: grid;
  grid-template-columns: minmax(260px, 0.75fr) minmax(0, 1.25fr);
  gap: 64px;
  padding-top: 90px;
  padding-bottom: 90px;
  border-top: 1px solid #d7e0e6;
}

.guide-permissions > div p {
  color: #56697a;
  line-height: 1.75;
}

.guide-permissions dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  margin: 0;
}

.guide-permissions dl div {
  padding-top: 14px;
  border-top: 1px solid #d7e0e6;
}

.guide-permissions dt {
  font-weight: 760;
}

.guide-permissions dd {
  margin: 7px 0 0;
  color: #56697a;
  line-height: 1.6;
}

.guide-faq {
  display: grid;
  grid-template-columns: minmax(250px, 0.68fr) minmax(0, 1.32fr);
  gap: 64px;
  padding-top: 90px;
  padding-bottom: 130px;
  border-top: 1px solid #d7e0e6;
}

.guide-faq details {
  border-bottom: 1px solid #d7e0e6;
}

.guide-faq summary {
  padding: 22px 4px;
  font-size: 17px;
  font-weight: 740;
  cursor: pointer;
}

.guide-faq details p {
  margin: 0;
  padding: 0 4px 24px;
  color: #56697a;
  line-height: 1.75;
}

@media (max-width: 850px) {
  .guide-basics,
  .guide-module-grid,
  .guide-permissions,
  .guide-faq {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .guide-module-grid {
    gap: 26px;
  }
}

@media (max-width: 560px) {
  .guide-hero h1 {
    font-size: clamp(36px, 10vw, 42px);
  }

  .guide-basics ol,
  .guide-permissions dl {
    grid-template-columns: 1fr;
  }

  .guide-module header {
    align-items: flex-start;
    flex-direction: column;
  }

  .guide-marker {
    width: 29px;
    height: 29px;
    border-width: 2px;
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(html) {
    scroll-behavior: auto;
  }
}
</style>
