import { describe, it, expect } from 'vitest';
import { credentialFor } from '../src/transport/credential.js';

describe('credentialFor()', () => {
  it('routes /api/v1 to the API key', () => {
    expect(credentialFor('/api/v1/products')).toBe('apiKey');
    expect(credentialFor('/api/v1/pages/pg_1/publish')).toBe('apiKey');
  });

  it('routes the private site API to the session', () => {
    expect(credentialFor('/api/sites/s1/menus')).toBe('session');
    expect(credentialFor('/api/sites/{siteId}/pages/{pageId}/source')).toBe('session');
  });

  it('routes the auth endpoints to no credential', () => {
    expect(credentialFor('/api/auth/login')).toBe('none');
    expect(credentialFor('/api/auth/refresh')).toBe('none');
  });

  it('defaults an unknown path to the session, not the API key', () => {
    expect(credentialFor('/api/orgs')).toBe('session');
  });

  it('is not fooled by a v1-looking segment further along the path', () => {
    expect(credentialFor('/api/sites/s1/apps/v1/blocks')).toBe('session');
  });

  it('does not treat /api/v10 as /api/v1', () => {
    expect(credentialFor('/api/v10/products')).toBe('session');
  });
});
