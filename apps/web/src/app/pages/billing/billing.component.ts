import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { BillingService, InvoiceIntent } from '../../services/billing.service';

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule,
  ],
  template: `
    <div class="billing-container">
      <h2><mat-icon>credit_card</mat-icon> Billing</h2>

      <!-- Create Invoice -->
      <mat-card class="billing-card">
        <mat-card-header>
          <mat-card-title>Create Invoice</mat-card-title>
          <mat-card-subtitle>Generate a payment intent for a contract</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="invoiceForm" (ngSubmit)="createInvoice()">
            <div class="form-row">
              <mat-form-field appearance="outline">
                <mat-label>Contract ID</mat-label>
                <input matInput formControlName="contractId" placeholder="clxxx...">
                <mat-error *ngIf="invoiceForm.get('contractId')?.hasError('required')">Required</mat-error>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Amount</mat-label>
                <input matInput type="number" formControlName="amount" placeholder="1000.00" min="0.01" step="0.01">
                <span matTextPrefix>$&nbsp;</span>
                <mat-error *ngIf="invoiceForm.get('amount')?.hasError('min')">Must be positive</mat-error>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Currency</mat-label>
                <mat-select formControlName="currency">
                  <mat-option value="usd">USD</mat-option>
                  <mat-option value="eur">EUR</mat-option>
                  <mat-option value="gbp">GBP</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <button mat-raised-button color="primary" type="submit"
              [disabled]="invoiceForm.invalid || submitting()">
              <mat-spinner *ngIf="submitting()" diameter="18" class="inline-spinner"></mat-spinner>
              <mat-icon *ngIf="!submitting()">receipt</mat-icon>
              Generate Invoice
            </button>
          </form>
        </mat-card-content>
      </mat-card>

      <!-- Payment Intent Result -->
      <mat-card *ngIf="invoiceResult()" class="billing-card result-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon color="primary">check_circle</mat-icon>
            Invoice Created
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <dl class="result-list">
            <dt>Invoice ID</dt>  <dd>{{ invoiceResult()!.invoiceId }}</dd>
            <dt>Amount</dt>      <dd>{{ invoiceResult()!.amountCents / 100 | currency:invoiceResult()!.currency.toUpperCase() }}</dd>
            <dt>Client Secret</dt>
            <dd class="secret">
              <code>{{ invoiceResult()!.clientSecret }}</code>
              <button mat-icon-button (click)="copySecret()" matTooltip="Copy to clipboard">
                <mat-icon>content_copy</mat-icon>
              </button>
            </dd>
          </dl>
          <p class="hint">
            Use this <code>clientSecret</code> with Stripe.js or the Stripe mobile SDK to complete payment on the client.
          </p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .billing-container { padding: 24px; max-width: 900px; margin: 0 auto; }
    h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
    .billing-card { margin-bottom: 24px; }
    .form-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .form-row mat-form-field { flex: 1; min-width: 180px; }
    .inline-spinner { display: inline-block; margin-right: 8px; }
    .result-card { border-left: 4px solid #4caf50; }
    .result-list { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; margin: 0; }
    dt { font-weight: 500; color: #555; }
    .secret { display: flex; align-items: center; gap: 8px; word-break: break-all; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    .hint { margin-top: 16px; color: #666; font-size: 13px; }
  `],
})
export class BillingComponent {
  private billingService = inject(BillingService);
  private snack          = inject(MatSnackBar);

  submitting    = signal(false);
  invoiceResult = signal<InvoiceIntent | null>(null);

  invoiceForm = new FormGroup({
    contractId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    amount:     new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0.01)] }),
    currency:   new FormControl('usd', { nonNullable: true }),
  });

  createInvoice(): void {
    if (this.invoiceForm.invalid) return;
    this.submitting.set(true);
    const { contractId, amount, currency } = this.invoiceForm.getRawValue();
    this.billingService.createInvoice({
      contractId,
      amountCents: Math.round(amount * 100),
      currency,
    }).subscribe({
      next: result => {
        this.invoiceResult.set(result);
        this.submitting.set(false);
        this.snack.open('Invoice created.', 'OK', { duration: 2500 });
      },
      error: err => {
        this.snack.open(err?.error?.message ?? 'Failed to create invoice.', 'Dismiss', { duration: 4000 });
        this.submitting.set(false);
      },
    });
  }

  copySecret(): void {
    const secret = this.invoiceResult()?.clientSecret;
    if (secret) {
      navigator.clipboard.writeText(secret);
      this.snack.open('Copied to clipboard.', 'OK', { duration: 1500 });
    }
  }
}
