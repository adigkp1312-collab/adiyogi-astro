/**
 * render-article.mjs — pure deterministic renderers. No fs, no db, no LLM.
 * Turns a finished article row (+ parsed sections) into:
 *   - the article body html (assemble step)
 *   - the full standalone article page (publish step)
 *   - the /articles listing page
 *   - the data/articles.json manifest
 *   - scripts/dv-state.json (dashboard-compatible)
 *   - sitemap.xml
 */

const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+Devanagari:wght@400;600;700&display=swap" rel="stylesheet" />`;

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function countWords(sections) {
  if (!Array.isArray(sections)) return 0;
  let text = '';
  for (const s of sections) {
    text += ' ' + (s.heading || '');
    text += ' ' + (Array.isArray(s.paragraphs) ? s.paragraphs.join(' ') : '');
    if (s.list) text += ' ' + (s.list.intro || '') + ' ' + (Array.isArray(s.list.items) ? s.list.items.join(' ') : '');
    if (Array.isArray(s.faq)) text += ' ' + s.faq.map(f => `${f.q || ''} ${f.a || ''}`).join(' ');
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function toArticleId(heading, i) {
  const base = String(heading || `section-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || `section-${i + 1}`;
}

// Article inner body — the assemble step stores this in the `html` column.
export function renderArticleBody(sections) {
  if (!Array.isArray(sections)) return '';
  const parts = [];
  sections.forEach((s, i) => {
    const id = toArticleId(s.id || s.heading, i);
    parts.push(`<section id="${escapeHtml(id)}">`);
    parts.push(`<h2>${escapeHtml(s.heading)}</h2>`);
    for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) {
      if (String(p).trim()) parts.push(`<p>${escapeHtml(p)}</p>`);
    }
    if (s.list && Array.isArray(s.list.items) && s.list.items.length) {
      if (s.list.intro) parts.push(`<p class="list-intro">${escapeHtml(s.list.intro)}</p>`);
      parts.push('<ul>' + s.list.items.map(it => `<li>${escapeHtml(it)}</li>`).join('') + '</ul>');
    }
    if (Array.isArray(s.faq) && s.faq.length) {
      parts.push('<dl class="faq">' + s.faq.map(f => `<dt>${escapeHtml(f.q)}</dt><dd>${escapeHtml(f.a)}</dd>`).join('') + '</dl>');
    }
    parts.push('</section>');
  });
  return parts.join('\n');
}

function jsonLd(row, url) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: row.title,
    description: row.meta_description,
    articleSection: row.category,
    keywords: Array.isArray(row.tags) ? row.tags.join(', ') : undefined,
    datePublished: row.published_at || undefined,
    dateModified: row.published_at || undefined,
    author: { '@type': 'Organization', name: 'Daivik Vani' },
    publisher: { '@type': 'Organization', name: 'Daivik Vani' },
    mainEntityOfPage: url,
  };
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Daivik Vani', item: url.replace(/\/articles\/.*$/, '/') },
      { '@type': 'ListItem', position: 2, name: 'Articles', item: url.replace(/[^/]*$/, '') },
      { '@type': 'ListItem', position: 3, name: row.title, item: url },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(article)}</script>
<script type="application/ld+json">${JSON.stringify(crumb)}</script>`;
}

function pageShell({ title, description, canonical, head = '', body }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${FONT_LINKS}
    <link rel="stylesheet" href="/articles/articles.css" />
    ${head}
  </head>
  <body>
    <header class="site-header">
      <div class="header-inner container">
        <a href="/" class="brand"><span class="brand-mark">DV</span><span class="brand-name">Daivik Vani</span></a>
        <nav aria-label="Primary"><a href="/articles/">Articles</a><a href="/#launch">Get started</a></nav>
      </div>
    </header>
    ${body}
    <footer class="site-footer">
      <div class="container footer-inner">
        <div>
          <p class="footer-name">Daivik Vani</p>
          <p class="footer-tag">Ancient Vedic timing wisdom, delivered through AI.</p>
        </div>
        <p class="footer-back"><a href="/articles/">← All articles</a></p>
      </div>
    </footer>
  </body>
</html>
`;
}

// Full standalone article page. `row.tags` must be a parsed array.
export function renderArticlePage(row, url) {
  const body = `<main class="article-wrap">
      <div class="container">
        <nav class="breadcrumb"><a href="/">Daivik Vani</a> / <a href="/articles/">Articles</a> / ${escapeHtml(row.category)}</nav>
        <span class="article-category">${escapeHtml(row.category)}</span>
        <h1 class="article-title">${escapeHtml(row.title)}</h1>
        <p class="article-lede">${escapeHtml(row.meta_description)}</p>
        <p class="article-meta"><span>${escapeHtml(row.category)}</span><span>${row.word_count || 0} words</span>${row.published_at ? `<span>${escapeHtml(String(row.published_at).slice(0, 10))}</span>` : ''}</p>
        <article class="prose">
${row.html}
        </article>
      </div>
    </main>`;
  return pageShell({
    title: `${row.title} · Daivik Vani`,
    description: row.meta_description,
    canonical: url,
    head: jsonLd(row, url),
    body,
  });
}

// Listing page grouped by category. `entries` = manifest array.
export function renderListingPage(entries, baseUrl) {
  const byCategory = {};
  for (const e of entries) (byCategory[e.category] ||= []).push(e);
  const order = Object.keys(byCategory).sort();
  const groups = order.map(cat => {
    const cards = byCategory[cat]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(e => `<a class="card" href="/articles/${escapeHtml(e.slug)}.html">
            <h3>${escapeHtml(e.title)}</h3>
            <p>${escapeHtml(e.meta_description)}</p>
          </a>`).join('\n          ');
    return `<div class="listing-group">
          <h2>${escapeHtml(cat)}</h2>
          <div class="card-grid">
          ${cards}
          </div>
        </div>`;
  }).join('\n        ');
  const body = `<main>
      <div class="listing-head container">
        <h1 class="listing-title">Articles</h1>
        <p class="listing-sub">Vedic astrology, muhurat, and panchang — explained.</p>
      </div>
      <div class="container">
        ${entries.length ? groups : '<p class="empty">No articles published yet.</p>'}
      </div>
    </main>`;
  return pageShell({
    title: 'Articles · Daivik Vani',
    description: 'Vedic astrology, muhurat, and panchang guides from Daivik Vani.',
    canonical: `${baseUrl}/articles/`,
    body,
  });
}

// Manifest entry from a full artifact object.
export function manifestEntry(art, baseUrl) {
  return {
    slug: art.slug,
    title: art.title,
    meta_description: art.meta_description,
    category: art.category,
    era: art.era,
    tags: Array.isArray(art.tags) ? art.tags : (typeof art.tags === 'string' ? safeArr(art.tags) : []),
    word_count: art.word_count || 0,
    published_at: art.published_at || null,
    url: `${baseUrl}/articles/${art.slug}.html`,
  };
}

function safeArr(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

// Dashboard-compatible state file: drafts[] = {url, title, bureau, era, status, createdAt}
export function renderDvState(entries) {
  return {
    generatedAt: new Date().toISOString(),
    drafts: entries.map(e => ({
      url: e.url,
      title: e.title,
      bureau: e.category,
      era: e.era || 'evergreen',
      status: 'published',
      createdAt: e.published_at || null,
    })),
  };
}

export function renderSitemap(entries, baseUrl) {
  const urls = [`${baseUrl}/`, `${baseUrl}/articles/`, ...entries.map(e => e.url)];
  const body = urls.map(u => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}
