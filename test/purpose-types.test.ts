import { describe, it, expect } from 'vitest';
import { layoutForPageName, missingUsualPages, purposeTypeForName } from '../src/domains/site/inventory.js';

/**
 * about, contact, policy, faq, login and register are PAGE TYPES now (web_builder
 * 8459371d9): slug-routed like `page`, told apart by purpose and icon.
 */
describe('purpose page types', () => {
  it('reads the type off the name, and leaves an ordinary page ordinary', () => {
    expect(purposeTypeForName('Giới thiệu')).toBe('about');
    expect(purposeTypeForName('Liên hệ')).toBe('contact');
    expect(purposeTypeForName('Chính sách bảo mật')).toBe('policy');
    // Not inferred: a lead form called "Đăng ký tư vấn" is no account page.
    expect(purposeTypeForName('Đăng nhập')).toBeUndefined();
    expect(purposeTypeForName('Đăng ký tư vấn')).toBeUndefined();
    expect(purposeTypeForName('Bộ sưu tập mùa hè')).toBeUndefined();
  });

  it('opens a purpose type as its own layout, but never the unbound auth form', () => {
    expect(layoutForPageName('Công ty', 'about')).toBe('about');
    expect(layoutForPageName('Hỏi đáp', 'faq')).toBe('faq');
    expect(layoutForPageName('Đăng nhập', 'login')).toBeUndefined();
    expect(layoutForPageName('Liên hệ', 'contact')).toBeUndefined();
    expect(layoutForPageName('Sản phẩm', 'product')).toBeUndefined();
  });

  it('counts a page of the purpose type as present whatever it is called', () => {
    const keys = missingUsualPages([{ id: 'p1', name: 'Our story', slug: 'story', type: 'about' }]).map((u) => u.key);
    expect(keys).not.toContain('about');
    expect(keys).toContain('contact');
  });
});
