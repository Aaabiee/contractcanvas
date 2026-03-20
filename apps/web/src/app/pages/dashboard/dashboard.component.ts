import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { BreakpointObserver, Breakpoints, LayoutModule } from '@angular/cdk/layout';
import { map, shareReplay } from 'rxjs';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipDefaultOptions, MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';

import { AuthService } from '../../services/auth.service';
import { ConfirmLogoutDialogComponent } from './confirm-logout.dialog';

type Role = 'ADMIN' | 'LAWYER' | 'PARALEGAL' | 'CLIENT';

export const tooltipOpts: MatTooltipDefaultOptions = {
  showDelay: 250,
  hideDelay: 0,
  touchendHideDelay: 150,
  position: 'below',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: tooltipOpts }],
  imports: [
    CommonModule,
    RouterModule,
    LayoutModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule,
    MatSlideToggleModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  public authService = inject(AuthService);
  private router     = inject(Router);
  private snack      = inject(MatSnackBar);
  private dialog     = inject(MatDialog);
  private bp         = inject(BreakpointObserver);

  isHandset$ = this.bp.observe(Breakpoints.Handset).pipe(
    map(r => r.matches),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  themeDark = signal<boolean>((() => localStorage.getItem('cc.theme') === 'dark')());
  constructor() {
    effect(() => {
      const dark = this.themeDark();
      document.body.classList.toggle('theme-dark', dark);
      localStorage.setItem('cc.theme', dark ? 'dark' : 'light');
    });
  }
  toggleTheme(val: boolean) {
    this.themeDark.set(val);
  }

  displayName = computed(() => {
    const u = this.authService.currentUser();
    if (!u) return '';
    const a = u as any;
    return a.name?.displayName?.trim() || a.displayName?.trim() || a.firstName?.trim() || '';
  });

  userRole = computed<Role>(() => {
    const u = this.authService.currentUser();
    return (u?.role as Role) ?? 'CLIENT';
  });

  canSeeAdmin = computed(() => this.userRole() === 'ADMIN');

  goTo(path: string) {
    this.router.navigate([path]);
  }

  async onLogout() {
    const confirmed = await this.dialog
      .open(ConfirmLogoutDialogComponent, { width: '360px', autoFocus: false })
      .afterClosed()
      .toPromise();

    if (!confirmed) return;

    try {
      this.authService.logout();
      this.snack.open('You have been logged out.', 'OK', { duration: 2500 });
      this.router.navigate(['/login']);
    } catch {
      this.snack.open('Logout failed. Please try again.', 'Dismiss', { duration: 3000 });
    }
  }
}
