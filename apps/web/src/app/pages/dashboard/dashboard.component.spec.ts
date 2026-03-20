import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../services/auth.service';

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

  beforeEach(async () => {
    dialog   = { open: jest.fn(() => ({ afterClosed: () => of(true) })) };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
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
});
