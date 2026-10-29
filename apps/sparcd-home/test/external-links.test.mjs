import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
const links = [...footer.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
const text = (markup) => markup.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const attr = (markup, name) => markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

test('uses the requested sentence and three external destinations', () => {
  assert.match(text(footer), /^We are an Open Source project/);
  assert.deepEqual(links.map(([, attributes, contents]) => ({
    label: text(contents), href: attr(attributes, 'href'),
  })), [
    { label: 'Open Source', href: 'https://opensource.org/osd' },
    { label: 'View on GitHub', href: 'https://github.com/CulverLab/sparcd-exploration' },
    { label: 'Wildcat Research', href: 'https://www.wildcatresearch.arizona.edu/' },
  ]);
});

test('external links consistently declare new contexts and decorative trailing icons', () => {
  assert.equal(links.length, 3);
  for (const [, attributes, contents] of links) {
    assert.equal(attr(attributes, 'target'), '_blank');
    assert.deepEqual(attr(attributes, 'rel').split(/\s+/).sort(), ['noopener', 'noreferrer']);
    assert.equal(attr(attributes, 'aria-describedby'), 'external-link-help');
    assert.match(contents, /<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"[\s\S]*<\/svg>\s*$/);
  }
  assert.match(footer, /id="external-link-help"[^>]*>Opens in a new tab or window\./);
});
