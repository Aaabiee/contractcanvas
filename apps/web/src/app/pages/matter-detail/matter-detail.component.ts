import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatterService, Matter } from '../../services/matter.service';
import { ContractService, Contract } from '../../services/contract.service';
import { DocumentService, Document } from '../../services/document.service';
import { TaskService, Task } from '../../services/task.service';
import { forkJoin, of, switchMap } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface MatterData {
  matter:    Matter;
  contracts: Contract[];
  documents: Document[];
}

@Component({
  selector: 'app-matter-detail',
  standalone: true,
  imports: [
    CommonModule, RouterLink, ReactiveFormsModule,
    MatTabsModule, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatFormFieldModule, MatInputModule,
    MatCheckboxModule,
  ],
  templateUrl: './matter-detail.component.html',
  styleUrls: ['./matter-detail.component.css'],
})
export class MatterDetailComponent implements OnInit {
  private matterService   = inject(MatterService);
  private contractService = inject(ContractService);
  private documentService = inject(DocumentService);
  private taskService     = inject(TaskService);
  private route           = inject(ActivatedRoute);
  private snack           = inject(MatSnackBar);

  matter    = signal<Matter | null>(null);
  contracts = signal<Contract[]>([]);
  documents = signal<Document[]>([]);
  tasks     = signal<Task[]>([]);
  loading   = signal(true);
  error     = signal('');

  matterId = signal('');

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (!id) { this.error.set('No Matter ID provided in URL.'); this.loading.set(false); return; }
      this.matterId.set(id);
      this.loadAll(id);
    });
  }

  loadAll(id: string): void {
    this.loading.set(true);
    forkJoin({
      matter:    this.matterService.getMatter(id),
      contracts: this.contractService.getContracts(id).pipe(
        catchError(() => of({ data: [], total: 0, limit: 50, offset: 0 }))
      ),
      documents: this.documentService.getDocuments(id).pipe(catchError(() => of([]))),
      tasks:     this.taskService.getTasks({ matterId: id }).pipe(
        catchError(() => of({ data: [], total: 0, limit: 50, offset: 0 }))
      ),
    }).pipe(
      catchError(err => {
        this.error.set('Could not load matter details.');
        return of(null);
      })
    ).subscribe(result => {
      if (result) {
        this.matter.set(result.matter);
        this.contracts.set((result.contracts as any).data ?? result.contracts);
        this.documents.set(Array.isArray(result.documents) ? result.documents : (result.documents as any).data ?? []);
        this.tasks.set((result.tasks as any).data ?? result.tasks);
      }
      this.loading.set(false);
    });
  }

  toggleTask(task: Task): void {
    const obs = task.completedAt
      ? this.taskService.reopenTask(task.id)
      : this.taskService.completeTask(task.id);
    obs.subscribe({
      next: updated => {
        this.tasks.update(list => list.map(t => t.id === updated.id ? updated : t));
        this.snack.open(updated.completedAt ? 'Task completed.' : 'Task reopened.', 'OK', { duration: 1500 });
      },
      error: () => this.snack.open('Could not update task.', 'Dismiss', { duration: 2500 }),
    });
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  isOverdue(task: Task): boolean {
    return !task.completedAt && !!task.dueAt && new Date(task.dueAt) < new Date();
  }

  statusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'OPEN':        return 'primary';
      case 'ON_HOLD':     return 'accent';
      case 'CLOSED':      return 'warn';
      case 'DRAFT':       return 'primary';
      case 'EXECUTED':    return 'accent';
      case 'ARCHIVED':    return 'warn';
      default:            return 'primary';
    }
  }
}
