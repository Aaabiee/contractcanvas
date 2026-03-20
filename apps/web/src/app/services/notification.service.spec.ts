import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NotificationService, NotificationPage, Notification } from './notification.service';

function makePage(overrides: Partial<NotificationPage> = {}): NotificationPage {
  return { data: [], total: 0, unreadCount: 0, limit: 10, offset: 0, ...overrides };
}

function makeNotif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1', userId: 'u1', organizationId: 'org-1',
    type: 'SYSTEM', title: 'Test', body: null, data: null,
    readAt: null, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('getNotifications()', () => {
    it('GETs /api/notifications with no params when called with no args', () => {
      service.getNotifications().subscribe();
      const req = http.expectOne('/api/notifications');
      expect(req.request.method).toBe('GET');
      req.flush(makePage());
    });

    it('sends unread=true when unread param is true', () => {
      service.getNotifications({ unread: true }).subscribe();
      const req = http.expectOne(r => r.url === '/api/notifications');
      expect(req.request.params.get('unread')).toBe('true');
      req.flush(makePage());
    });

    it('sends limit and offset params', () => {
      service.getNotifications({ limit: 5, offset: 10 }).subscribe();
      const req = http.expectOne(r => r.url === '/api/notifications');
      expect(req.request.params.get('limit')).toBe('5');
      expect(req.request.params.get('offset')).toBe('10');
      req.flush(makePage());
    });

    it('updates unreadCount signal from page.unreadCount', () => {
      service.getNotifications().subscribe();
      http.expectOne('/api/notifications').flush(makePage({ unreadCount: 7 }));
      expect(service.unreadCount()).toBe(7);
    });

    it('returns the page data in the observable', () => {
      const page = makePage({ data: [makeNotif()], total: 1 });
      let result: NotificationPage | undefined;
      service.getNotifications().subscribe(p => (result = p));
      http.expectOne('/api/notifications').flush(page);
      expect(result!.total).toBe(1);
      expect(result!.data).toHaveLength(1);
    });
  });

  describe('markRead()', () => {
    it('PATCHes /api/notifications/:id/read', () => {
      service.markRead('n1').subscribe();
      const req = http.expectOne('/api/notifications/n1/read');
      expect(req.request.method).toBe('PATCH');
      req.flush(makeNotif({ readAt: new Date().toISOString() }));
    });

    it('decrements unreadCount by 1 (minimum 0)', () => {
      service.unreadCount.set(3);
      service.markRead('n1').subscribe();
      http.expectOne('/api/notifications/n1/read').flush(makeNotif());
      expect(service.unreadCount()).toBe(2);
    });

    it('does not go below 0 when unreadCount is already 0', () => {
      service.unreadCount.set(0);
      service.markRead('n1').subscribe();
      http.expectOne('/api/notifications/n1/read').flush(makeNotif());
      expect(service.unreadCount()).toBe(0);
    });
  });

  describe('markAllRead()', () => {
    it('PATCHes /api/notifications/read-all', () => {
      service.markAllRead().subscribe();
      const req = http.expectOne('/api/notifications/read-all');
      expect(req.request.method).toBe('PATCH');
      req.flush({ ok: true, updated: 5 });
    });

    it('sets unreadCount to 0', () => {
      service.unreadCount.set(5);
      service.markAllRead().subscribe();
      http.expectOne('/api/notifications/read-all').flush({ ok: true, updated: 5 });
      expect(service.unreadCount()).toBe(0);
    });
  });

  it('initial unreadCount is 0', () => {
    expect(service.unreadCount()).toBe(0);
  });
});
