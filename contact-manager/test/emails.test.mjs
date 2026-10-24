// Email syntax, role addresses and disposable domains.
import { describe, expect, it } from 'vitest';
import {
  DISPOSABLE_DOMAINS, ROLE_LOCAL_PARTS, emailDomain, emailLocalPart, inspectEmail,
  isDisposableAddress, isEmailSyntax, isRoleAddress,
} from '../src/lib/emails.js';

describe('isEmailSyntax', () => {
  it('accepts the addresses a contact book actually holds', () => {
    for (const address of ['ada@example.org', 'a.b+tag@sub.example.co.uk', 'x@y.de', "o'brien@example.ie"]) {
      expect(isEmailSyntax(address), address).toBe(true);
    }
  });

  it('rejects the shapes that break a mail client', () => {
    for (const address of [
      'nope', 'no@tld', '@example.org', 'ada@', 'a@b@c.de',
      'ada@exa mple.org', '.ada@example.org', 'ada.@example.org', 'a..b@example.org',
      'ada@-example.org', 'ada@example-.org', 'ada@example..org', '',
    ]) {
      expect(isEmailSyntax(address), address).toBe(false);
    }
  });

  it('trims before checking', () => {
    expect(isEmailSyntax('  ada@example.org  ')).toBe(true);
  });
});

describe('email parts', () => {
  it('splits the local part and the domain, lower-cased', () => {
    expect(emailLocalPart('Ada@Example.ORG')).toBe('ada');
    expect(emailDomain('Ada@Example.ORG')).toBe('example.org');
    expect(emailLocalPart('nonsense')).toBe('nonsense');
    expect(emailDomain('nonsense')).toBe('');
  });
});

describe('isRoleAddress', () => {
  it('recognises a function address', () => {
    for (const address of ['info@example.org', 'sales@example.org', 'no-reply@example.org', 'support@example.org']) {
      expect(isRoleAddress(address), address).toBe(true);
    }
    expect(isRoleAddress('info+de@example.org')).toBe(true);
  });

  it('leaves a person alone', () => {
    for (const address of ['ada@example.org', 'grace.hopper@example.org', 'information@example.org']) {
      expect(isRoleAddress(address), address).toBe(false);
    }
  });

  it('is a warning, never a rejection — the addresses are still valid syntax', () => {
    expect(isEmailSyntax('info@example.org')).toBe(true);
    expect(ROLE_LOCAL_PARTS).toContain('info');
  });
});

describe('isDisposableAddress', () => {
  it('recognises a known throwaway domain', () => {
    expect(isDisposableAddress('someone@mailinator.com')).toBe(true);
    expect(isDisposableAddress('someone@MAILINATOR.COM')).toBe(true);
  });

  it('leaves an ordinary domain alone', () => {
    expect(isDisposableAddress('ada@example.org')).toBe(false);
    expect(isDisposableAddress('')).toBe(false);
    expect(DISPOSABLE_DOMAINS).toContain('mailinator.com');
  });
});

describe('inspectEmail', () => {
  it('answers everything at once', () => {
    expect(inspectEmail('info@mailinator.com')).toEqual({
      syntax: true, role: true, disposable: true, domain: 'mailinator.com',
    });
    expect(inspectEmail('ada@example.org')).toEqual({
      syntax: true, role: false, disposable: false, domain: 'example.org',
    });
  });
});
