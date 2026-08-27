import { randomBytes } from 'node:crypto';

/**
 * Id prefixes, mirrored from schema/src/node.ts.
 *
 * Purely cosmetic — an id only has to be unique — but a document this server
 * builds should be indistinguishable from one a human built, and the prefix is
 * the first thing anyone reading a document sees. The tab family is listed
 * explicitly because the generic two-letter fallback collapses all three to 'ta'.
 */
const PREFIXES: Record<string, string> = {
  root: 'rt',
  'flex-section': 'fs',
  'flex-block': 'fb',
  heading: 'he',
  text: 'tx',
  button: 'bt',
  image: 'im',
  icon: 'ic',
  spacer: 'sp',
  tab: 'tb',
  'tab-content': 'tc',
  'tab-item': 'ti',
};

export function genId(type: string): string {
  const prefix = PREFIXES[type] ?? (type.replace(/[^a-z]/g, '').slice(0, 2) || 'nd');
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
