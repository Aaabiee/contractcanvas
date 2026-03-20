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

import { ContractService, Contract } from '../../services/contract.service';
import { MatterService, Matter } from '../../services/matter.service';

// ── New Contract Dialog ────────────────────────────────────────────────────

@Component({
  selector: 'app-new-contract-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>New Contract</h2>
    <mat-dialog-content>
      <div *ngIf="loadingMatters()" class="spinner-row">
        <mat-spinner diameter="32"></mat-spinner>
      </div>
      <form [formGroup]="form" class="dialog-form" *ngIf="!loadingMatters()">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Title</mat-label>
          <input matInput formControlName="title" placeholder="e.g. Master Service Agreement" cdkFocusInitial>
          <mat-icon matPrefix>description</mat-icon>
          <mat-error *ngIf="form.get('title')?.hasError('required')">Title is required</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Matter</mat-label>
          <mat-select formControlName="matterId">
            <mat-option *ngFor="let m of matters()" [value]="m.id">{{ m.title }}</mat-option>
          </mat-select>
          <mat-icon matPrefix>work</mat-icon>
          <mat-error *ngIf="form.get('matterId')?.hasError('required')">Matter is required</mat-error>
          <mat-hint *ngIf="matters().length === 0">No open matters — create a matter first</mat-hint>
        </mat-form-field>
        <div class="row-two">
          <mat-form-field appearance="outline">
            <mat-label>Value (optional)</mat-label>
            <input matInput type="number" formControlName="valueDollars" min="0" placeholder="0.00">
            <span matTextPrefix>$&nbsp;</span>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Currency</mat-label>
            <mat-select formControlName="currency">
              <mat-option value="USD">USD</mat-option>
              <mat-option value="EUR">EUR</mat-option>
              <mat-option value="GBP">GBP</mat-option>
              <mat-option value="CAD">CAD</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary"
        [disabled]="form.invalid || loadingMatters() || matters().length === 0"
        (click)="save()">
        <mat-icon>add</mat-icon> Create Contract
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; }
    .full { width: 100%; }
    .row-two { display: flex; gap: 12px; }
    .row-two mat-form-field { flex: 1; }
    .spinner-row { display: flex; justify-content: center; padding: 24px; }
  `],
})
export class NewContractDialogComponent implements OnInit {
  dialogRef     = inject(MatDialogRef<NewContractDialogComponent>);
  private matterService = inject(MatterService);

  matters       = signal<Matter[]>([]);
  loadingMatters = signal(true);

  form = new FormGroup({
    title:        new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    matterId:     new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    valueDollars: new FormControl<number | null>(null),
    currency:     new FormControl('USD', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.matterService.getMatters({ status: 'OPEN', limit: 100 })
      .pipe(catchError(() => of({ data: [] as Matter[], total: 0, limit: 100, offset: 0 })))
      .subscribe(page => {
        this.matters.set(page.data);
        this.loadingMatters.set(false);
        if (page.data.length === 1) this.form.get('matterId')!.setValue(page.data[0].id);
      });
  }

  save(): void {
    if (this.form.invalid) return;
    const { title, matterId, valueDollars, currency } = this.form.getRawValue();
    this.dialogRef.close({
      title,
      matterId,
      ...(valueDollars != null ? { valueCents: Math.round(valueDollars * 100), currency } : {}),
    });
  }
}

// ── Contract List ──────────────────────────────────────────────────────────

type ContractStatus = 'ALL' | 'DRAFT' | 'NEGOTIATION' | 'PENDING_SIGNATURE' | 'EXECUTED' | 'ARCHIVED';

@Component({
  selector: 'app-contract-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatChipsModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatCardModule, MatTooltipModule,
  ],
  templateUrl: './contract-list.component.html',
  styleUrls: ['./contract-list.component.css'],
})
export class ContractListComponent implements OnInit, AfterViewInit {
  private contractService = inject(ContractService);
  private router          = inject(Router);
  private route           = inject(ActivatedRoute);
  private dialog          = inject(MatDialog);
  private snack           = inject(MatSnackBar);

  loading = signal(false);
  error   = signal('');
  total   = signal(0);

  dataSource = new MatTableDataSource<Contract>([]);
  cols = ['title', 'matter', 'status', 'value', 'createdAt', 'actions'];

  search       = new FormControl('', { nonNullable: true });
  statusFilter = new FormControl<ContractStatus>('ALL', { nonNullable: true });

  readonly statusOptions: { value: ContractStatus; label: string }[] = [
    { value: 'ALL',               label: 'All' },
    { value: 'DRAFT',             label: 'Draft' },
    { value: 'NEGOTIATION',       label: 'Negotiation' },
    { value: 'PENDING_SIGNATURE', label: 'Pending Sign.' },
    { value: 'EXECUTED',          label: 'Executed' },
    { value: 'ARCHIVED',          label: 'Archived' },
  ];

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
      (row.matter?.title ?? '').toLowerCase().includes(f);
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const status = this.statusFilter.value === 'ALL' ? undefined : this.statusFilter.value;
    this.contractService.getContracts(undefined, { status, limit: 200 })
      .pipe(catchError(() => {
        this.error.set('Failed to load contracts. Please try again.');
        return of({ data: [] as Contract[], total: 0, limit: 200, offset: 0 });
      }))
      .subscribe(page => {
        this.dataSource.data = page.data;
        this.total.set(page.total);
        this.loading.set(false);
      });
  }

  openCreate(): void {
    this.dialog.open(NewContractDialogComponent, { width: '520px', autoFocus: true })
      .afterClosed()
      .subscribe((data?: any) => {
        if (!data) return;
        this.contractService.createContract(data).subscribe({
          next: contract => {
            this.dataSource.data = [contract, ...this.dataSource.data];
            this.total.update(n => n + 1);
            const ref = this.snack.open(`"${contract.title}" created.`, 'View', { duration: 4000 });
            ref.onAction().subscribe(() => this.router.navigate(['/contracts', contract.id]));
          },
          error: err => this.snack.open(
            err?.error?.message ?? 'Failed to create contract.', 'Dismiss', { duration: 4000 }),
        });
      });
  }

  confirmDelete(contract: Contract, event: Event): void {
    event.stopPropagation();
    const ref = this.snack.open(`Delete "${contract.title}"?`, 'Delete', { duration: 5000 });
    ref.onAction().subscribe(() => {
      this.contractService.deleteContract(contract.id).subscribe({
        next: () => {
          this.dataSource.data = this.dataSource.data.filter(c => c.id !== contract.id);
          this.total.update(n => n - 1);
          this.snack.open('Contract deleted.', 'OK', { duration: 2500 });
        },
        error: () => this.snack.open('Failed to delete contract.', 'Dismiss', { duration: 3000 }),
      });
    });
  }

  goTo(contract: Contract): void {
    this.router.navigate(['/contracts', contract.id]);
  }

  formatValue(c: Contract): string {
    if (c.valueCents == null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (c.currency ?? 'USD').toUpperCase(),
    }).format(c.valueCents / 100);
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      DRAFT: 'Draft', NEGOTIATION: 'Negotiation',
      PENDING_SIGNATURE: 'Pending Sign.', EXECUTED: 'Executed', ARCHIVED: 'Archived',
    };
    return map[s] ?? s;
  }
}
