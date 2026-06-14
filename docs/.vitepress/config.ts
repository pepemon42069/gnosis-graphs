import { defineConfig } from 'vitepress'

export default defineConfig({
  // Served by the app's own server under /docs (and embedded in an in-app viewer),
  // so every asset/link must resolve under that base.
  base: '/docs/',
  title: 'gnosis-graphs',
  description:
    'A self-hosted, graph-focused knowledge workspace: a SQLite-backed server, a canvas for authoring, and a per-graph DSL — built with Vite, React 19, and TypeScript.',
  cleanUrls: true,
  // localhost URLs are intentional run-it-yourself references the dead-link
  // checker can never reach; keep checking every other link.
  ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?/],
  themeConfig: {
    search: { provider: 'local' },
    outline: 'deep',
    nav: [
      { text: 'Why', link: '/guide/why-gnosis-graphs' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture/overview' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Why gnosis-graphs', link: '/guide/why-gnosis-graphs' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Using the canvas', link: '/guide/using-the-canvas' },
          { text: 'Decomposing a document', link: '/guide/decomposing-a-document' },
          { text: 'DSL reference', link: '/guide/dsl-reference' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/overview' },
          { text: 'Server', link: '/architecture/server' },
          { text: 'Data & commands', link: '/architecture/data-and-commands' },
          { text: 'Client seam', link: '/architecture/client-seam' },
          { text: 'DSL engine', link: '/architecture/dsl-engine' },
          { text: 'Data model', link: '/architecture/data-model' },
          { text: 'API reference', link: '/architecture/api-reference' },
          { text: 'Build & deploy', link: '/architecture/build-and-deploy' },
        ],
      },
      {
        text: 'History',
        items: [
          { text: 'Project spec v1', link: '/history/project-spec-v1' },
        ],
      },
    ],
  },
})
