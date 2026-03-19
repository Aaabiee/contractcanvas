import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TaskService, Task } from '../../services/task.service';
import { debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    CommonModule, RouterModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatFormFieldModule,
    MatSelectModule, MatCheckboxModule, MatTooltipModule,
  ],
  template: `
    <div class="tasks-container">
      <div class="tasks-header">
        <h2><mat-icon>task_alt</mat-icon> Tasks</h2>
        <div class="header-filters">
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Filter</mat-label>
            <mat-select [formControl]="filter">
              <mat-option value="all">All Tasks</mat-option>
              <mat-option value="pending">Pending</mat-option>
              <mat-option value="completed">Completed</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      <div *ngIf="loading()" class="loading-center">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <div *ngIf="error()" class="error-message">{{ error() }}</div>

      <div *ngIf="!loading() && !error()">
        <div *ngIf="tasks().length === 0" class="empty-state">
          <mat-icon class="empty-icon">task_alt</mat-icon>
          <p>No tasks found.</p>
        </div>

        <mat-card *ngFor="let task of tasks(); trackBy: taskById" class="task-card"
                  [class.task-completed]="!!task.completedAt">
          <mat-card-content>
            <div class="task-row">
              <mat-checkbox
                [checked]="!!task.completedAt"
                (change)="toggleComplete(task)"
                [matTooltip]="task.completedAt ? 'Mark as pending' : 'Mark as done'">
              </mat-checkbox>
              <div class="task-body">
                <span class="task-title" [class.done]="!!task.completedAt">{{ task.title }}</span>
                <div class="task-meta">
                  <a [routerLink]="['/matters', task.matter?.id]" class="matter-link">
                    <mat-icon class="small-icon">work</mat-icon> {{ task.matter?.title }}
                  </a>
                  <span *ngIf="task.assignee" class="assignee">
                    <mat-icon class="small-icon">person</mat-icon>
                    {{ task.assignee.firstName }} {{ task.assignee.lastName }}
                  </span>
                  <span *ngIf="task.dueAt" class="due" [class.overdue]="isOverdue(task)">
                    <mat-icon class="small-icon">event</mat-icon>
                    {{ task.dueAt | date:'MMM d, y' }}
                    <mat-chip *ngIf="isOverdue(task)" color="warn" selected>Overdue</mat-chip>
                  </span>
                </div>
                <p *ngIf="task.description" class="task-description">{{ task.description }}</p>
              </div>
            </div>
          </mat-card-content>
        </mat-card>
      </div>

      <div class="pagination" *ngIf="total() > pageSize">
        <button mat-button [disabled]="offset() === 0" (click)="prev()">
          <mat-icon>chevron_left</mat-icon> Prev
        </button>
        <span>{{ offset() + 1 }}–{{ Math.min(offset() + pageSize, total()) }} of {{ total() }}</span>
        <button mat-button [disabled]="offset() + pageSize >= total()" (click)="next()">
          Next <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .tasks-container { padding: 24px; max-width: 900px; margin: 0 auto; }
    .tasks-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .tasks-header h2 { display: flex; align-items: center; gap: 8px; margin: 0; }
    .filter-field { width: 160px; }
    .loading-center { display: flex; justify-content: center; padding: 40px; }
    .error-message { color: var(--mdc-theme-error, #f44336); padding: 16px; }
    .empty-state { text-align: center; padding: 48px; color: #888; }
    .empty-icon { font-size: 48px; width: 48px; height: 48px; }
    .task-card { margin-bottom: 12px; transition: opacity 0.2s; }
    .task-card.task-completed { opacity: 0.65; }
    .task-row { display: flex; align-items: flex-start; gap: 16px; }
    .task-body { flex: 1; min-width: 0; }
    .task-title { font-size: 15px; font-weight: 500; display: block; }
    .task-title.done { text-decoration: line-through; color: #888; }
    .task-meta { display: flex; gap: 16px; margin-top: 6px; flex-wrap: wrap; font-size: 13px; color: #666; }
    .matter-link { display: flex; align-items: center; gap: 4px; color: inherit; text-decoration: none; }
    .matter-link:hover { text-decoration: underline; }
    .assignee, .due { display: flex; align-items: center; gap: 4px; }
    .due.overdue { color: #f44336; font-weight: 500; }
    .small-icon { font-size: 14px; width: 14px; height: 14px; }
    .task-description { margin: 8px 0 0; font-size: 13px; color: #555; white-space: pre-wrap; }
    .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 24px; }
  `],
})
export class TasksComponent implements OnInit {
  private taskService = inject(TaskService);
  private snack       = inject(MatSnackBar);

  readonly Math   = Math;
  readonly pageSize = 20;

  tasks   = signal<Task[]>([]);
  total   = signal(0);
  offset  = signal(0);
  loading = signal(false);
  error   = signal('');

  filter = new FormControl<'all' | 'pending' | 'completed'>('all', { nonNullable: true });

  ngOnInit(): void {
    this.load();
    this.filter.valueChanges.pipe(debounceTime(100), distinctUntilChanged()).subscribe(() => {
      this.offset.set(0);
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const completed = this.filter.value === 'all' ? undefined
      : this.filter.value === 'completed';
    this.taskService.getTasks({ completed, limit: this.pageSize, offset: this.offset() })
      .subscribe({
        next: page => {
          this.tasks.set(page.data);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Failed to load tasks.');
          this.loading.set(false);
        },
      });
  }

  toggleComplete(task: Task): void {
    const obs = task.completedAt
      ? this.taskService.reopenTask(task.id)
      : this.taskService.completeTask(task.id);

    obs.subscribe({
      next: updated => {
        this.tasks.update(list => list.map(t => t.id === updated.id ? updated : t));
        this.snack.open(updated.completedAt ? 'Task completed.' : 'Task reopened.', 'OK', { duration: 1800 });
      },
      error: () => this.snack.open('Could not update task.', 'Dismiss', { duration: 3000 }),
    });
  }

  isOverdue(task: Task): boolean {
    return !task.completedAt && !!task.dueAt && new Date(task.dueAt) < new Date();
  }

  taskById(_: number, t: Task): string { return t.id; }

  prev(): void { this.offset.update(o => Math.max(0, o - this.pageSize)); this.load(); }
  next(): void { this.offset.update(o => o + this.pageSize); this.load(); }
}
