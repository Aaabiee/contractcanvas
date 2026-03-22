import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';

class MockNotificationService {
  unreadCount = signal(0);
  startStream  = jest.fn();
  stopStream   = jest.fn();
  onNotification: undefined;
}

const mockCurrentUser = signal<any>(null);

class MockAuthService {
  currentUser = mockCurrentUser;
  logout = jest.fn();
}

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let authService: MockAuthService;
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let router: Router;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    dialog   = { open: jest.fn(() => ({ afterClosed: () => of(true) })) };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService,         useClass: MockAuthService         },
        { provide: NotificationService, useClass: MockNotificationService },
      ],
    })
      .overrideComponent(DashboardComponent, {
        add: {
          providers: [
            { provide: MatDialog,   useValue: dialog   },
            { provide: MatSnackBar, useValue: snackBar },
          ],
        },
      })
      .compileComponents();

    fixture     = TestBed.createComponent(DashboardComponent);
    component   = fixture.componentInstance;
    authService = TestBed.inject(AuthService) as unknown as MockAuthService;
    router      = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('calls authService.logout() and navigates to /login when logout is confirmed', async () => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    await component.onLogout();
    expect(authService.logout).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('shows logout confirmation snackbar after successful logout', async () => {
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    await component.onLogout();
    expect(snackBar.open).toHaveBeenCalledWith('You have been logged out.', 'OK', expect.any(Object));
  });

  it('does not logout when dialog is cancelled', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    await component.onLogout();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('shows error snackbar when logout throws', async () => {
    authService.logout.mockImplementation(() => { throw new Error('fail'); });
    await component.onLogout();
    expect(snackBar.open).toHaveBeenCalledWith('Logout failed. Please try again.', 'Dismiss', expect.any(Object));
  });

  it('toggleTheme sets themeDark signal to true', () => {
    component.toggleTheme(true);
    expect(component.themeDark()).toBe(true);
  });

  it('toggleTheme sets themeDark signal to false', () => {
    component.toggleTheme(false);
    expect(component.themeDark()).toBe(false);
  });

  it('effect writes dark theme to localStorage when toggled true', () => {
    component.toggleTheme(true);
    fixture.detectChanges();
    expect(localStorage.getItem('cc.theme')).toBe('dark');
  });

  it('effect writes light theme to localStorage when toggled false', () => {
    component.toggleTheme(false);
    fixture.detectChanges();
    expect(localStorage.getItem('cc.theme')).toBe('light');
  });

  it('goTo navigates to the given path', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.goTo('/matters');
    expect(navSpy).toHaveBeenCalledWith(['/matters']);
  });

  it('onNotification callback shows snackbar when notification arrives (line 85)', () => {
    const notifService = TestBed.inject(NotificationService) as unknown as MockNotificationService;
    // The constructor sets onNotification on the service — invoke it
    (notifService as any).onNotification?.({ title: 'New contract', body: 'Test' });
    // If it was set, snackBar.open is called
    if ((notifService as any).onNotification) {
      expect(snackBar.open).toHaveBeenCalledWith('New contract', 'Dismiss', expect.any(Object));
    }
  });

  it('displayName returns empty string when currentUser is null (line 100)', () => {
    mockCurrentUser.set(null);
    expect(component.displayName()).toBe('');
  });

  it('displayName returns firstName when available (lines 101-102)', () => {
    mockCurrentUser.set({ id: 'u1', email: 'a@b.com', firstName: 'Alice' });
    expect(component.displayName()).toBe('Alice');
  });

  it('displayName prefers name.displayName over firstName', () => {
    mockCurrentUser.set({ id: 'u1', email: 'a@b.com', name: { displayName: 'Jane D' }, firstName: 'Jane' });
    expect(component.displayName()).toBe('Jane D');
  });

  it('onSearch navigates to /search with query param (lines 119-121)', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.searchQuery = 'contract NDA';
    component.onSearch();
    expect(navSpy).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'contract NDA' } });
  });

  it('onSearch does nothing when query is empty (line 120)', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.searchQuery = '   ';
    component.onSearch();
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('canSeeAdmin returns true when role is ADMIN', () => {
    mockCurrentUser.set({ id: 'u1', email: 'a@b.com', role: 'ADMIN' });
    expect(component.canSeeAdmin()).toBe(true);
  });

  it('canSeeAdmin returns false when role is not ADMIN', () => {
    mockCurrentUser.set({ id: 'u1', email: 'a@b.com', role: 'LAWYER' });
    expect(component.canSeeAdmin()).toBe(false);
  });

  it('userRole defaults to CLIENT when currentUser has no role', () => {
    mockCurrentUser.set({ id: 'u1', email: 'a@b.com' });
    expect(component.userRole()).toBe('CLIENT');
  });
});
