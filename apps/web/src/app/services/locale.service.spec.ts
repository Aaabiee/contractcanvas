import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { LocaleService, SUPPORTED_LOCALES } from './locale.service';

describe('LocaleService', () => {
  let service: LocaleService;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: LOCALE_ID, useValue: 'en' }],
    });
    service = TestBed.inject(LocaleService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('currentLocale returns the injected LOCALE_ID', () => {
    expect(service.currentLocale).toBe('en');
  });

  it('supportedLocales contains en, es, fr, de', () => {
    expect(service.supportedLocales).toHaveLength(4);
    const codes = service.supportedLocales.map(l => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('es');
    expect(codes).toContain('fr');
    expect(codes).toContain('de');
  });

  it('getStoredLocale returns en by default', () => {
    expect(service.getStoredLocale()).toBe('en');
  });

  it('getStoredLocale returns stored value', () => {
    localStorage.setItem('cc.locale', 'fr');
    expect(service.getStoredLocale()).toBe('fr');
  });

  it('setLocale stores the locale in localStorage', () => {
    service.setLocale('de');
    expect(localStorage.getItem('cc.locale')).toBe('de');
  });

  it('setLocale ignores unsupported locale codes', () => {
    service.setLocale('xx');
    expect(localStorage.getItem('cc.locale')).toBeNull();
  });

  it('SUPPORTED_LOCALES is exported', () => {
    expect(SUPPORTED_LOCALES).toBeDefined();
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
  });
});
