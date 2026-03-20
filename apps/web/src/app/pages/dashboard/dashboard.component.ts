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
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { TaskService } from '../../services/task.service';
import { NotificationService } from '../../services/notification.service';
import { ConfirmLogoutDialogComponent } from './confirm-logout.dialog';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements AfterViewInit {
  public authService      = inject(AuthService);
  private router          = inject(Router);
  private snack           = inject(MatSnackBar);
  private dialog          = inject(MatDialog);
  private bp              = inject(BreakpointObserver);
  private matterService   = inject(MatterService);
  private contractService = inject(ContractService);
  private taskService     = inject(TaskService);
  public  notifService    = inject(NotificationService);

  isHandset$ = this.bp.observe(Breakpoints.Handset).pipe(
    map(r => r.matches),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  loading = signal(false);

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

  search = new FormControl<string>('', { nonNullable: true });
  readonly searchValue = signal<string>('');
  ngOnInit() {
    this.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe(v => this.searchValue.set((v ?? '').trim().toLowerCase()));

    this.loadStats();

    this.taskService.getTasks({ completed: false, limit: 10 }).pipe(
      catchError(() => of({ data: [], total: 0, limit: 10, offset: 0 }))
    ).subscribe(page => {
      const rows = page.data.map(t => ({
        title:    t.title,
        due:      t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—',
        status:   t.completedAt ? 'Done' : 'Pending',
        assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : 'Unassigned',
        id:       t.id,
      }));
      this.dataSource.data = rows;
    });
  }

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

  stats = signal([
    { label: 'Open Matters', icon: 'work', value: 0, color: 'primary', link: '/matters' },
    { label: 'Active Contracts', icon: 'description', value: 0, color: 'accent', link: '/contracts' },
    { label: 'Pending Tasks', icon: 'task_alt', value: 0, color: 'warn', link: '/tasks' },
    { label: 'Notifications', icon: 'notifications', value: 0, color: 'primary', link: '/dashboard' },
  ]);
  statTrackBy = (_: number, s: any) => s.label;

  loadStats(): void {
    forkJoin({
      matters:       this.matterService.getMatters({ status: 'OPEN', limit: 1 }).pipe(catchError(() => of({ data: [], total: 0, limit: 1, offset: 0 }))),
      contracts:     this.contractService.getContracts().pipe(catchError(() => of({ data: [], total: 0, limit: 1, offset: 0 }))),
      pendingTasks:  this.taskService.getTasks({ completed: false, limit: 1 }).pipe(catchError(() => of({ data: [], total: 0, limit: 1, offset: 0 }))),
      notifications: this.notifService.getNotifications({ unread: true, limit: 1 }).pipe(catchError(() => of({ data: [], total: 0, unreadCount: 0, limit: 1, offset: 0 }))),
    }).subscribe(({ matters, contracts, pendingTasks, notifications }) => {
      this.stats.set([
        { label: 'Open Matters',     icon: 'work',          value: matters.total,          color: 'primary', link: '/matters' },
        { label: 'Active Contracts', icon: 'description',   value: contracts.total,         color: 'accent',  link: '/contracts' },
        { label: 'Pending Tasks',    icon: 'task_alt',       value: pendingTasks.total,      color: 'warn',    link: '/tasks' },
        { label: 'Unread Alerts',    icon: 'notifications', value: notifications.unreadCount, color: 'primary', link: '/dashboard' },
      ]);
    });
  }

  recent = signal([
    { icon: 'rate_review', text: 'Comment on NDA v2', when: '2h ago', link: '/contracts' },
    { icon: 'upload', text: 'Uploaded "MSA_v1.pdf"', when: '5h ago', link: '/contracts' },
    { icon: 'send', text: 'Envelope sent to john@acme.com', when: 'Yesterday', link: '/contracts' },
  ]);
  recentFiltered = computed(() => {
    const q = this.searchValue();
    if (!q) return this.recent();
    return this.recent().filter(r => r.text.toLowerCase().includes(q));
  });
  recentTrackBy = (_: number, r: any) => r.text + r.when;

  quickActions = signal([
    { icon: 'add',             label: 'New Matter',    tip: 'Create a new matter',   to: '/matters' },
    { icon: 'assignment_add',  label: 'New Contract',  tip: 'Create a contract',     to: '/contracts' },
    { icon: 'task_alt',        label: 'View Tasks',    tip: 'View all tasks',         to: '/tasks' },
    { icon: 'credit_card',     label: 'Billing',       tip: 'Billing & invoices',    to: '/billing' },
    { icon: 'business',        label: 'Org Settings',  tip: 'Manage organization',   to: '/settings/organization' },
  ]);
  qaTrackBy = (_: number, a: any) => a.label;

  displayedColumns: string[] = ['title', 'due', 'status', 'assignee', 'actions'];
  dataSource = new MatTableDataSource<any>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    this.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe(v => {
        this.dataSource.filter = (v ?? '').trim().toLowerCase();
      });
    this.dataSource.filterPredicate = (row, filter) =>
      Object.values(row).some(val => String(val).toLowerCase().includes(filter));
  }

  openTask(row: any) {
    this.snack.open(`Open task: ${row.title}`, 'OK', { duration: 1500 });
  }
  markDone(row: any) {
    this.snack.open(`Marked done: ${row.title}`, 'Undo', { duration: 1500 });
  }
}
