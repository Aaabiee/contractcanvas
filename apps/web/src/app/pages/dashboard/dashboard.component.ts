import {
  Component,
  ChangeDetectionStrategy,
  ViewChild,
  inject,
  signal,
  computed,
  effect,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { BreakpointObserver, Breakpoints, LayoutModule } from '@angular/cdk/layout';
import { map, shareReplay, debounceTime, distinctUntilChanged } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

// Angular Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatRippleModule } from '@angular/material/core';
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
    ReactiveFormsModule,
    LayoutModule,
    // Material
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatMenuModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatBadgeModule,
    MatSnackBarModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatSlideToggleModule,
    MatRippleModule,
    ConfirmLogoutDialogComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements AfterViewInit {
  // Services
  public authService = inject(AuthService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private bp = inject(BreakpointObserver);

  // Responsive sidenav mode
  isHandset$ = this.bp.observe(Breakpoints.Handset).pipe(
    map(r => r.matches),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Loading state (swap to service-driven if available)
  loading = signal(false);

  // Theme toggle (persisted)
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

  // Search control (toolbar)
  search = new FormControl<string>('', { nonNullable: true });
  readonly searchValue = signal<string>('');
  ngOnInit() {
    this.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe(v => this.searchValue.set((v ?? '').trim().toLowerCase()));
  }

  // User display/role
  displayName = computed(() => {
    const u = (this.authService as any).currentUser ?? (this.authService as any).user ?? null;
    if (!u) return '';
    if (u.firstName || u.lastName) return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return u.name || u.email || '';
  });
  userRole = computed<Role>(() => {
    const u = (this.authService as any).currentUser ?? null;
    return (u?.role as Role) ?? 'CLIENT';
  });
  canSeeAdmin = computed(() => this.userRole() === 'ADMIN');

  // Navigation
  goTo(path: string) {
    this.router.navigate([path]);
  }

  // Logout with confirm
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

  // Stats
  stats = signal([
    { label: 'Open Matters', icon: 'work', value: 6, color: 'primary', link: '/matters' },
    { label: 'Active Contracts', icon: 'description', value: 12, color: 'accent', link: '/contracts' },
    { label: 'Pending Signatures', icon: 'edit_document', value: 3, color: 'warn', link: '/contracts' },
    { label: 'Upcoming Reminders', icon: 'event', value: 5, color: 'primary', link: '/reminders' },
  ]);
  statTrackBy = (_: number, s: any) => s.label;

  // Recent activity
  recent = signal([
    { icon: 'rate_review', text: 'Comment on NDA v2', when: '2h ago', link: '/contracts/123' },
    { icon: 'upload', text: 'Uploaded “MSA_v1.pdf”', when: '5h ago', link: '/documents/abc' },
    { icon: 'send', text: 'Envelope sent to john@acme.com', when: 'Yesterday', link: '/contracts/777' },
  ]);
  recentFiltered = computed(() => {
    const q = this.searchValue();
    if (!q) return this.recent();
    return this.recent().filter(r => r.text.toLowerCase().includes(q));
  });
  recentTrackBy = (_: number, r: any) => r.text + r.when;

  // Quick actions (convert to a FAB on handset in template)
  quickActions = signal([
    { icon: 'add', label: 'New Matter', tip: 'Create a new matter', to: '/matters/new' },
    { icon: 'note_add', label: 'Upload Doc', tip: 'Upload a document', to: '/documents/upload' },
    { icon: 'assignment_add', label: 'New Contract', tip: 'Create a contract', to: '/contracts/new' },
    { icon: 'event', label: 'Add Reminder', tip: 'Set a reminder', to: '/reminders/new' },
  ]);
  qaTrackBy = (_: number, a: any) => a.label;

  // My Tasks (demo) — Material Table
  displayedColumns: string[] = ['title', 'due', 'status', 'assignee', 'actions'];
  dataSource = new MatTableDataSource([
    { title: 'Draft MSA for Acme', due: '2025-11-02', status: 'In review', assignee: 'You' },
    { title: 'Send NDA to Vendor', due: '2025-10-29', status: 'Pending', assignee: 'You' },
    { title: 'Invoice for Q3 work', due: '2025-11-05', status: 'Blocked', assignee: 'Billing' },
  ]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    // Hook the global search into the table filter too
    this.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe(v => {
        this.dataSource.filter = (v ?? '').trim().toLowerCase();
      });
    this.dataSource.filterPredicate = (row, filter) =>
      Object.values(row).some(val => String(val).toLowerCase().includes(filter));
  }

  // Row actions
  openTask(row: any) {
    this.snack.open(`Open task: ${row.title}`, 'OK', { duration: 1500 });
  }
  markDone(row: any) {
    this.snack.open(`Marked done: ${row.title}`, 'Undo', { duration: 1500 });
  }
}