import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const SITE_MEDIA = Object.freeze({
  'drinkware-hero': ['hero', 'Stainless steel flask on a dark surface with ice'],
  'drinkware-insulated': ['insulated', 'Person holding a stainless steel bottle'],
  'drinkware-sport': ['sport', 'Sports water bottle on a floor'],
  'drinkware-travel': ['travel', 'Travel cup on a light table'],
  'drinkware-everyday': ['everyday', 'Black water bottle against warm yellow'],
  'drinkware-tumbler': ['tumbler', 'Stainless steel coffee tumbler'],
  'drinkware-trail': ['trail', 'Flask on a rock in the mountains'],
});

const uploads = new URL('../data/site-media/', import.meta.url);
const uploadPattern = /^upload-[a-f0-9]{24}$/;
const photoUrl = (id, extension = 'webp') => new URL(`${id}.${extension}`, uploads);
export const isSiteMedia = id => typeof id === 'string' && (Object.hasOwn(SITE_MEDIA, id) || (uploadPattern.test(id) && existsSync(photoUrl(id))));
export const siteMediaPath = id => isSiteMedia(id) ? `/assets/${id}.webp` : null;

export function listSiteMedia(spec, request) {
  const ids = new Set(`${request} ${JSON.stringify(spec?.pages || [])}`.match(/\bupload-[a-f0-9]{24}\b/g) || []);
  const images = Object.entries(SITE_MEDIA).map(([id, [, description]]) => ({ id, description }));
  for (const id of [...ids].slice(0, 40)) {
    if (isSiteMedia(id)) {
      const description = existsSync(photoUrl(id, 'txt')) ? readFileSync(photoUrl(id, 'txt'), 'utf8') : 'Uploaded project photo';
      images.push({ id, description });
    }
  }
  return images;
}

export function saveSiteMedia(content, name) {
  if (content.length < 20 || content.subarray(0, 4).toString() !== 'RIFF' || content.readUInt32LE(4) !== content.length - 8 || content.subarray(8, 12).toString() !== 'WEBP' || !['VP8 ', 'VP8L', 'VP8X'].includes(content.subarray(12, 16).toString())) return null;
  const id = `upload-${createHash('sha256').update(content).digest('hex').slice(0, 24)}`;
  const label = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  const description = label && !/\b(?:sk-|gh[pousr]_)[a-z0-9_-]{16,}/i.test(label) ? label : 'Uploaded project photo';
  mkdirSync(uploads, { recursive: true });
  if (!existsSync(photoUrl(id))) {
    writeFileSync(photoUrl(id, 'txt'), description);
    writeFileSync(photoUrl(id), content);
  }
  return { id, description };
}

export function readSiteMedia(id) {
  if (!isSiteMedia(id)) return null;
  if (uploadPattern.test(id)) return readFileSync(photoUrl(id));
  const [name] = SITE_MEDIA[id];
  return readFileSync(new URL(`../public/images/store/${name}.webp`, import.meta.url));
}

export function siteMediaFiles(spec) {
  const ids = new Set();
  for (const page of spec.pages || []) {
    for (const section of page.sections) {
      if (section.media) ids.add(section.media.id);
      for (const item of section.items || []) if (item.media) ids.add(item.media.id);
    }
  }
  if (!ids.size) return [];
  return [
    ...[...ids].map(id => ({ path: `public${siteMediaPath(id)}`, content: readSiteMedia(id) })),
    ...([...ids].some(id => Object.hasOwn(SITE_MEDIA, id)) ? [{ path: 'PHOTO-SOURCES.md', content: readFileSync(new URL('../public/images/store/SOURCES.md', import.meta.url), 'utf8') }] : []),
  ];
}
