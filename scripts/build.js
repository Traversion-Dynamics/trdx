'use strict';

/*
  Static build for hosts such as Vercel, Netlify or GitHub Pages.
  Copies public/ to dist/, fills in %%SITE_URL%% and %%CONTACT_TO%% from environment
  variables, and writes robots.txt and sitemap.xml. No dependencies.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
} catch (e) {
  /* no config file: environment variables only */
}

/* The public address. In order: SITE_URL variable, site.config.json, a CNAME file
   (custom domain on GitHub Pages), the GitHub repository name, Vercel's address. */
function detectSiteUrl() {
  if ((process.env.SITE_URL || '').trim()) return process.env.SITE_URL.trim();
  if ((config.siteUrl || '').trim()) return config.siteUrl.trim();
  try {
    const cname = fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();
    if (cname) return 'https://' + cname;
  } catch (e) {
    /* no CNAME */
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo && repo.indexOf('/') > 0) {
    const [owner, name] = repo.split('/');
    const host = owner.toLowerCase() + '.github.io';
    return 'https://' + host + (name.toLowerCase() === host ? '' : '/' + name);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return '';
}

let siteUrl = detectSiteUrl();
if (!siteUrl) {
  siteUrl = 'http://localhost:3000';
  console.warn('[warn] No public address found: canonical links and the sitemap will point at localhost. Set siteUrl in site.config.json.');
}
siteUrl = siteUrl.replace(/\/+$/, '');

let contactTo = (process.env.CONTACT_TO || config.contactTo || '').trim();
if (!EMAIL_RE.test(contactTo)) {
  console.warn('[warn] contactTo is missing or not a valid email: the contact page will say it is not set up.');
  contactTo = '';
}

/* static hosts have no /api/contact, so the form posts to FormSubmit, which emails contactTo */
const formEndpoint = contactTo ? 'https://formsubmit.co/ajax/' + contactTo : '';

const esc = (v) => String(v).replace(/[&"<>]/g, '');
const extraHead = [
  /* static hosts cannot send headers, so the policy goes in a meta tag */
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; font-src \'self\'; connect-src \'self\' https://formsubmit.co; media-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'">',
  config.googleSiteVerification ? '<meta name="google-site-verification" content="' + esc(config.googleSiteVerification) + '">' : '',
  config.bingSiteVerification ? '<meta name="msvalidate.01" content="' + esc(config.bingSiteVerification) + '">' : ''
].filter(Boolean).join('\n');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

(function fill(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return fill(full);
    if (!/\.html$/.test(entry.name)) return;
    const html = fs
      .readFileSync(full, 'utf8')
      .replace(/%%SITE_URL%%/g, siteUrl)
      .replace(/%%CONTACT_TO%%/g, contactTo)
      /* email_off stops Cloudflare's email obfuscation from rewriting the address in the endpoint */
      .replace(/<form([^>]*)data-endpoint="\/api\/contact"([^>]*)>/, formEndpoint ? '<!--email_off--><form$1data-endpoint="' + formEndpoint + '"$2><!--/email_off-->' : '$&')
      .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + extraHead);
    fs.writeFileSync(full, html);
  });
})(OUT);

fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + siteUrl + '/sitemap.xml\n');

const today = new Date().toISOString().slice(0, 10);
const pages = [
  ['/', 'weekly', '1.0'],
  ['/missions.html', 'monthly', '0.8'],
  ['/contact.html', 'yearly', '0.6'],
  ['/privacy.html', 'yearly', '0.2']
];
fs.writeFileSync(
  path.join(OUT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages
      .map(([p, f, pr]) => '  <url>\n    <loc>' + siteUrl + p + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <changefreq>' + f + '</changefreq>\n    <priority>' + pr + '</priority>\n  </url>')
      .join('\n') +
    '\n</urlset>\n'
);

fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
if (fs.existsSync(path.join(ROOT, 'CNAME'))) fs.copyFileSync(path.join(ROOT, 'CNAME'), path.join(OUT, 'CNAME'));

console.log('Built dist/ for ' + siteUrl + (contactTo ? ' (contact: ' + contactTo + ')' : ''));
