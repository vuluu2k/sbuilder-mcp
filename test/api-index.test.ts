import { describe, it, expect } from 'vitest';
import { API_OPERATIONS, API_DEFINITIONS, SWAGGER_SOURCE } from '../src/catalog/api.generated.js';

describe('generated API index', () => {
  it('carries every operation in the document', () => {
    expect(API_OPERATIONS.length).toBe(SWAGGER_SOURCE.operations);
    expect(API_OPERATIONS.length).toBeGreaterThan(300);
  });

  it('has unique ids - the document has no operationId to fall back on', () => {
    const ids = new Set(API_OPERATIONS.map((o) => o.id));
    expect(ids.size).toBe(API_OPERATIONS.length);
  });

  it('routes /api/v1 operations to the API key and site operations to the session', () => {
    const v1 = API_OPERATIONS.find((o) => o.path.startsWith('/api/v1/'));
    expect(v1?.credential).toBe('apiKey');
    const site = API_OPERATIONS.find((o) => o.path.startsWith('/api/sites/'));
    expect(site?.credential).toBe('session');
  });

  it('knows the page source route and flags its body as undescribed', () => {
    const op = API_OPERATIONS.find(
      (o) => o.method === 'PUT' && o.path === '/api/sites/{siteId}/pages/{pageId}/source',
    );
    expect(op).toBeDefined();
    expect(op!.bodyDescribed).toBe(false);
  });

  it('resolves a body $ref into a real definition when there is one', () => {
    const described = API_OPERATIONS.filter((o) => o.bodyDescribed);
    expect(described.length).toBeGreaterThan(50);
    for (const o of described) {
      expect(API_DEFINITIONS[o.bodyRef!]).toBeDefined();
    }
  });

  it('records the exact path-param casing the platform uses, inconsistencies included', () => {
    expect(API_OPERATIONS.some((o) => o.path === '/api/sites/{siteID}/menus')).toBe(true);
    expect(API_OPERATIONS.some((o) => o.path.includes('/api/sites/{siteId}/pages'))).toBe(true);
  });
});
