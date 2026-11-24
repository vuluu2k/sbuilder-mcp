import { describe, it, expect } from 'vitest';
import { compactSite } from '../src/tools/session.js';

const PERMS = Array.from({ length: 54 }, (_, i) => `perm.${i}`);
const row = (over: Record<string, unknown>) => ({
  id: 'site_1', name: 'Shop', slug: 'shop', publicUrl: 'https://shop.sbuilder.site', role: 'owner',
  ownerId: 'u', createdAt: '2026-01-01', deletedAt: '0001-01-01T00:00:00Z', subdomainRedirect: true,
  subdomainRedirectCode: 302, maintenanceMode: false, building: false, isTemplate: false, galleryListed: false,
  effectivePermissions: PERMS, preview: { url: 'x', width: 1, height: 1 }, ...over,
});

describe('sb_site_list rows', () => {
  it('an owner row drops the permission list and the zero-value noise', () => {
    const r = compactSite(row({}));
    expect(r).toEqual({ id: 'site_1', name: 'Shop', slug: 'shop', url: 'https://shop.sbuilder.site', role: 'owner' });
    expect(JSON.stringify(r).length, 'owner row').toBeLessThan(JSON.stringify(row({})).length / 5);
  });
  it('a non-owner row keeps its permissions — they are what differs', () => {
    expect(compactSite(row({ role: 'editor', effectivePermissions: ['pages.read'] })).permissions).toEqual(['pages.read']);
  });
  it('a true flag survives, each on its own', () => {
    expect(compactSite(row({ isTemplate: true, templateName: 'Atelier' })).template, 'template').toBe('Atelier');
    expect(compactSite(row({ maintenanceMode: true })).maintenance, 'maintenance').toBe(true);
    expect(compactSite(row({ building: true })).building, 'building').toBe(true);
    expect(compactSite(row({ orgId: 'org_1' })).org_id, 'org').toBe('org_1');
  });
});
