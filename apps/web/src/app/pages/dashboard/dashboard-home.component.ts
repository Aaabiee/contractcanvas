import {
  Component,
  ChangeDetectionStrategy,
  ViewChild,
  inject,
  signal,
  computed,
  OnInit,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatBadgeModule } from '@angular/material/badge';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatRippleModule } from '@angular/material/core';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AuthService } from '../../services/auth.service';
import { MatterService } from '../../services/matter.service';
import { ContractService } from '../../services/contract.service';
import { TaskService } from '../../services/task.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatBadgeModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatRippleModule,
    MatListModule,
    MatSnackBarModule,
  ],
  templateUrl: './dashboard-home.component.html',
  styles: [`
    .verify-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      color: #856404;
    }
    .verify-banner span { flex: 1; }
  `],
})
export class DashboardHomeComponent implements OnInit, AfterViewInit {
  private authService     = inject(AuthService);
  private router          = inject(Router);
  private snack           = inject(MatSnackBar);
  private matterService   = inject(MatterService);
  private contractService = inject(ContractService);
  private taskService     = inject(TaskService);
  public  notifService    = inject(NotificationService);

  loading = signal(false);

  showVerifyBanner = computed(() => {
    const u = this.authService.currentUser();
    return u !== null && (u as any).emailVerified === false;
  });
  resendState = signal<'idle' | 'sending' | 'sent'>('idle');

  resendVerification(): void {
    const email = this.authService.currentUser()?.email;
    if (!email || this.resendState() !== 'idle') return;
    this.resendState.set('sending');
    this.authService.resendVerification(email).subscribe({
      next: () => this.resendState.set('sent'),
      error: () => this.resendState.set('idle'),
    });
  }

  displayName = computed(() => {
    const u = this.authService.currentUser();
    if (!u) return '';
    const a = u as any;
    return a.name?.displayName?.trim() || a.displayName?.trim() || a.firstName?.trim() || '';
  });

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

  stats = signal([
    { label: 'Open Matters',     icon: 'work',          value: 0, color: 'primary', link: '/matters' },
    { label: 'Active Contracts', icon: 'description',   value: 0, color: 'accent',  link: '/contracts' },
    { label: 'Pending Tasks',    icon: 'task_alt',       value: 0, color: 'warn',    link: '/tasks' },
    { label: 'Notifications',   icon: 'notifications', value: 0, color: 'primary', link: '/dashboard' },
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
        { label: 'Open Matters',     icon: 'work',          value: matters.total,           color: 'primary', link: '/matters' },
        { label: 'Active Contracts', icon: 'description',   value: contracts.total,          color: 'accent',  link: '/contracts' },
        { label: 'Pending Tasks',    icon: 'task_alt',       value: pendingTasks.total,       color: 'warn',    link: '/tasks' },
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
    { icon: 'bar_chart',       label: 'Analytics',     tip: 'View analytics',         to: '/analytics' },
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

  goStatCard(s: { value: number; link: string }) {
    if (s.value >= 1) this.router.navigate([s.link]);
  }

  goTo(path: string) {
    this.router.navigate([path]);
  }

  openTask(row: any) {
    this.snack.open(`Open task: ${row.title}`, 'OK', { duration: 1500 });
  }

  markDone(row: any) {
    this.snack.open(`Marked done: ${row.title}`, 'Undo', { duration: 1500 });
  }
}
