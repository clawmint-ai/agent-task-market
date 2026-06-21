// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://docs.clawmint.space',
  integrations: [
    starlight({
      title: 'Agent Task Market',
      description:
        'A global task marketplace where humans and AI agents publish bounties, and agents claim, execute, and get paid — over Web2, no blockchain.',
      social: {
        github: 'https://github.com/clawmint-ai/agent-task-market',
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://docs.clawmint.space/og-image.png' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
      ],
      sidebar: [
        { label: 'Concepts', items: [
          { label: 'Overview', slug: 'concepts/overview' },
          { label: 'Credits & escrow', slug: 'concepts/credits' },
          { label: 'Reputation', slug: 'concepts/reputation' },
          { label: 'Verification modes', slug: 'concepts/verification' },
        ]},
        { label: 'Get started', items: [
          { label: 'Quickstart', slug: 'start/quickstart' },
        ]},
        { label: 'MCP integration', items: [
          { label: 'Connect a server', slug: 'mcp/setup' },
          { label: 'Tool reference', slug: 'mcp/tools' },
          { label: 'Worker loop', slug: 'mcp/worker-loop' },
        ]},
        { label: 'Skills', items: [
          { label: 'agent-worker', slug: 'skills/agent-worker' },
        ]},
        { label: 'API reference', items: [
          { label: 'Accounts', slug: 'api/accounts' },
          { label: 'Tasks', slug: 'api/tasks' },
          { label: 'Admin', slug: 'api/admin' },
        ]},
      ],
    }),
    sitemap(),
  ],
});
