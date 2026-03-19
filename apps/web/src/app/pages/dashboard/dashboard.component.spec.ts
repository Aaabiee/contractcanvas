import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../services/auth.service';
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { TaskService } from '../../services/task.service';
import { NotificationService } from '../../services/notification.service';

const mockCurrentUser = signal<any>(null);

const emptyPage      = { data: [], total: 0, limit: 1,  offset: 0 };
const emptyTaskPage  = { data: [], total: 0, limit: 10, offset: 0 };
const emptyNotifPage = { data: [], total: 0, unreadCount: 0, limit: 1, offset: 0 };

class MockAuthService {
  currentUser = mockCurrentUser;
  logout = jest.fn();
}

class MockMatterService {
  getMatters = jest.fn(() => of(emptyPage));
}

class MockContractService {
  getContracts = jest.fn(() => of(emptyPage));
}

class MockTaskService {
  getTasks = jest.fn(() => of(emptyTaskPage));
}

class MockNotificationService {
  unreadCount      = signal(0);
  getNotifications = jest.fn(() => of(emptyNotifPage));
}

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let authService: MockAuthService;
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let router: Router;

  beforeEach(async () => {
    dialog   = { open: jest.fn(() => ({ afterClosed: () => of(true) })) };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService,          useClass: MockAuthService          },
        { provide: MatterService,        useClass: MockMatterService        },
        { provide: ContractService,      useClass: MockContractService      },
        { provide: TaskService,          useClass: MockTaskService          },
        { provide: NotificationService,  useClass: MockNotificationService  },
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

  it('recentFiltered returns all items when searchValue is empty', () => {
    component.searchValue.set('');
    expect(component.recentFiltered().length).toBe(component.recent().length);
  });

  it('recentFiltered filters items by search term', () => {
    component.searchValue.set('nda');
    const filtered = component.recentFiltered();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every(r => r.text.toLowerCase().includes('nda'))).toBe(true);
  });

  it('recentFiltered returns empty array for non-matching term', () => {
    component.searchValue.set('zzznomatch');
    expect(component.recentFiltered()).toHaveLength(0);
  });

  it('goTo navigates to the given path', () => {
    const navSpy = jest.spyOn(router, 'navigate');
    component.goTo('/matters');
    expect(navSpy).toHaveBeenCalledWith(['/matters']);
  });
});
