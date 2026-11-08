// Build-time SEO from src/content/site.js (site.meta, site.faq, site.contact):
//  - injects <title>, meta description, keywords, canonical, Open Graph, Twitter, and JSON-LD
//    into index.html
//  - serves/emits robots.txt and sitemap.xml
// Tags are in the static HTML (not added by JavaScript later), so social-media scrapers and
// crawlers that don't run JavaScript still see them.
import { site } from './src/content/site.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// JSON inside <script> must not be able to close the tag.
const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// Site origin without a trailing slash. SITE_URL (env) overrides site.meta.canonical.
function siteUrl() {
  return (process.env.SITE_URL || site.meta.canonical).replace(/\/$/, '');
}

function jsonLd(base) {
  const { meta, brand, contact, faq } = site;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfessionalService',
        name: brand.name,
        url: `${base}/`,
        description: meta.schemaDescription,
        image: `${base}${meta.ogImage}`,
        serviceType: meta.serviceType,
        ...(contact.email && { email: contact.email }),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.items.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

function headTags() {
  const base = siteUrl();
  const m = site.meta;
  const image = `${base}${m.ogImage}`;
  const meta = (attr, key, content) => ({ tag: 'meta', attrs: { [attr]: key, content }, injectTo: 'head' });
  return [
    { tag: 'title', children: escapeHtml(m.title), injectTo: 'head-prepend' },
    meta('name', 'description', m.description),
    meta('name', 'keywords', m.keywords),
    { tag: 'link', attrs: { rel: 'canonical', href: `${base}/` }, injectTo: 'head' },
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', site.brand.name),
    meta('property', 'og:title', m.ogTitle),
    meta('property', 'og:description', m.ogDescription),
    meta('property', 'og:url', `${base}/`),
    meta('property', 'og:image', image),
    meta('property', 'og:locale', m.locale),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', m.ogTitle),
    meta('name', 'twitter:description', m.ogDescription),
    meta('name', 'twitter:image', image),
    { tag: 'script', attrs: { type: 'application/ld+json' }, children: safeJson(jsonLd(base)), injectTo: 'head' },
  ];
}

const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /manage-booking\n\nSitemap: ${siteUrl()}/sitemap.xml\n`;
const sitemap = () =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${siteUrl()}/</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n</urlset>\n`;

export function seoPlugin() {
  return {
    name: 'bytebun-seo',
    // Public pages only: the admin page (admin.html) gets no SEO tags, canonical or JSON-LD.
    transformIndexHtml: (html, ctx) => (ctx?.filename?.endsWith('admin.html') || html.includes('/src/admin/main.jsx') ? html : headTags()),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/robots.txt') return res.setHeader('content-type', 'text/plain').end(robots());
        if (req.url === '/sitemap.xml') return res.setHeader('content-type', 'application/xml').end(sitemap());
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
    },
  };
}
