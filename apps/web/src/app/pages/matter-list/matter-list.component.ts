import {
  Component, ChangeDetectionStrategy, inject, signal, OnInit, AfterViewInit, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged, take } from 'rxjs';
import { catchError, of } from 'rxjs';

import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MatterService, Matter } from '../../services/matter.service';

// ── New Matter Dialog ──────────────────────────────────────────────────────

@Component({
  selector: 'app-new-matter-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>New Matter</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Title</mat-label>
          <input matInput formControlName="title" placeholder="e.g. Smith v. Acme Corp" cdkFocusInitial>
          <mat-icon matPrefix>work</mat-icon>
          <mat-error *ngIf="form.get('title')?.hasError('required')">Title is required</mat-error>
          <mat-error *ngIf="form.get('title')?.hasError('minlength')">At least 2 characters</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Description (optional)</mat-label>
          <textarea matInput formControlName="description" rows="3"
            placeholder="Brief summary of this matter…"></textarea>
          <mat-icon matPrefix>notes</mat-icon>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Initial status</mat-label>
          <mat-select formControlName="status">
            <mat-option value="OPEN">Open</mat-option>
            <mat-option value="ON_HOLD">On Hold</mat-option>
            <mat-option value="CLOSED">Closed</mat-option>
          </mat-select>
          <mat-icon matPrefix>flag</mat-icon>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" [disabled]="form.invalid" (click)="save()">
        <mat-icon>add</mat-icon> Create Matter
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; }
    .full { width: 100%; }
  `],
})
export class NewMatterDialogComponent {
  dialogRef = inject(MatDialogRef<NewMatterDialogComponent>);

  form = new FormGroup({
    title:       new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    description: new FormControl('', { nonNullable: true }),
    status:      new FormControl<'OPEN' | 'ON_HOLD' | 'CLOSED'>('OPEN', { nonNullable: true }),
  });

  save(): void {
    if (this.form.valid) this.dialogRef.close(this.form.getRawValue());
  }
}

// ── Matter List ────────────────────────────────────────────────────────────

@Component({
  selector: 'app-matter-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatCardModule, MatTooltipModule,
  ],
  templateUrl: './matter-list.component.html',
  styleUrls: ['./matter-list.component.css'],
})
export class MatterListComponent implements OnInit, AfterViewInit {
  private matterService = inject(MatterService);
  private router        = inject(Router);
  private route         = inject(ActivatedRoute);
  private dialog        = inject(MatDialog);
  private snack         = inject(MatSnackBar);

  loading = signal(false);
  error   = signal('');
  total   = signal(0);

  dataSource = new MatTableDataSource<Matter>([]);
  cols = ['title', 'status', 'counts', 'createdAt', 'actions'];

  search       = new FormControl('', { nonNullable: true });
  statusFilter = new FormControl<'ALL' | 'OPEN' | 'ON_HOLD' | 'CLOSED'>('ALL', { nonNullable: true });

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort)      sort!: MatSort;

  ngOnInit(): void {
    this.load();

    this.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe(v => { this.dataSource.filter = v.trim().toLowerCase(); });

    this.statusFilter.valueChanges
      .pipe(distinctUntilChanged())
      .subscribe(() => this.load());

    this.route.queryParams.pipe(take(1)).subscribe(p => {
      if (p['create'] === '1') setTimeout(() => this.openCreate(), 150);
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort      = this.sort;
    this.dataSource.filterPredicate = (row, f) =>
      row.title.toLowerCase().includes(f) ||
      (row.description ?? '').toLowerCase().includes(f);
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const status = this.statusFilter.value === 'ALL' ? undefined : this.statusFilter.value;
    this.matterService.getMatters({ status, limit: 200 })
      .pipe(catchError(() => {
        this.error.set('Failed to load matters. Please try again.');
        return of({ data: [] as Matter[], total: 0, limit: 200, offset: 0 });
      }))
      .subscribe(page => {
        this.dataSource.data = page.data;
        this.total.set(page.total);
        this.loading.set(false);
      });
  }

  openCreate(): void {
    this.dialog.open(NewMatterDialogComponent, { width: '500px', autoFocus: true })
      .afterClosed()
      .subscribe((data?: { title: string; description: string; status: string }) => {
        if (!data) return;
        this.matterService.createMatter(data).subscribe({
          next: matter => {
            this.dataSource.data = [matter, ...this.dataSource.data];
            this.total.update(n => n + 1);
            const ref = this.snack.open(`"${matter.title}" created.`, 'View', { duration: 4000 });
            ref.onAction().subscribe(() => this.router.navigate(['/matters', matter.id]));
          },
          error: err => this.snack.open(
            err?.error?.message ?? 'Failed to create matter.', 'Dismiss', { duration: 4000 }),
        });
      });
  }

  confirmDelete(matter: Matter, event: Event): void {
    event.stopPropagation();
    const ref = this.snack.open(`Delete "${matter.title}"?`, 'Delete', { duration: 5000 });
    ref.onAction().subscribe(() => {
      this.matterService.deleteMatter(matter.id).subscribe({
        next: () => {
          this.dataSource.data = this.dataSource.data.filter(m => m.id !== matter.id);
          this.total.update(n => n - 1);
          this.snack.open('Matter deleted.', 'OK', { duration: 2500 });
        },
        error: () => this.snack.open('Failed to delete matter.', 'Dismiss', { duration: 3000 }),
      });
    });
  }

  goTo(matter: Matter): void {
    this.router.navigate(['/matters', matter.id]);
  }

  statusLabel(s: string): string {
    return ({ OPEN: 'Open', ON_HOLD: 'On Hold', CLOSED: 'Closed' } as Record<string, string>)[s] ?? s;
  }
}
