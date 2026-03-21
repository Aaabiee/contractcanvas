import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ContractService, Contract, ContractVersion } from '../../services/contract.service';
import { CommentsComponent } from '../../components/comments/comments.component';
import { Observable, of, forkJoin } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

export interface SignatureEnvelope {
  id:         string;
  provider:   string;
  status:     string;
  recipients: Array<{ email: string; name: string; role: string }>;
  createdAt:  string;
}

export interface ContractWithVersions {
  contract: Contract;
  versions: ContractVersion[];
}

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, CommentsComponent, MatButtonModule, MatIconModule, MatChipsModule, MatSnackBarModule, MatProgressSpinnerModule],
  providers: [CurrencyPipe],
  templateUrl: './contract-detail.component.html',
  styleUrls: ['./contract-detail.component.css'],
})
export class ContractDetailComponent implements OnInit {
  private contractService = inject(ContractService);
  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);
  private snack = inject(MatSnackBar);

  data$!: Observable<ContractWithVersions | null>;
  error = '';
  envelopes     = signal<SignatureEnvelope[]>([]);
  sendingSig    = signal(false);
  generatingPdf = signal(false);

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (!id) {
          this.error = 'No Contract ID provided in URL.';
          return of(null);
        }
        this.loadEnvelopes(id);
        return forkJoin({
          contract: this.contractService.getContract(id),
          versions: this.contractService.getVersions(id),
        }).pipe(
          catchError(err => {
            console.error('Error fetching contract:', err);
            this.error = 'Could not load contract details.';
            return of(null);
          })
        );
      })
    );
  }

  private currencyPipe = inject(CurrencyPipe);

  formatCents(cents: number | null | undefined, currency: string | null | undefined): string {
    if (cents == null) return '—';
    const curr = (currency ?? 'USD').toUpperCase();
    return this.currencyPipe.transform(cents / 100, curr) ?? '—';
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  loadEnvelopes(contractId: string): void {
    this.http.get<SignatureEnvelope[]>(`/api/signatures?contractId=${contractId}`).subscribe({
      next: list => this.envelopes.set(list),
      error: () => {},
    });
  }

  sendForSignature(contractId: string): void {
    this.sendingSig.set(true);
    this.http.post<any>('/api/signatures', {
      contractId,
      provider: 'docusign',
      recipients: [{ email: '', name: '', role: 'signer' }],
    }).subscribe({
      next: env => {
        this.envelopes.update(es => [env, ...es]);
        this.sendingSig.set(false);
        this.snack.open('Sent for signature.', 'OK', { duration: 2500 });
      },
      error: err => {
        this.sendingSig.set(false);
        this.snack.open(err?.error?.error ?? 'Failed to send.', 'Dismiss', { duration: 3000 });
      },
    });
  }

  generatePdf(contractId: string): void {
    this.generatingPdf.set(true);
    this.http.post(`/api/contracts/${contractId}/generate-pdf`, {}, { responseType: 'blob' }).subscribe({
      next: blob => {
        this.generatingPdf.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${contractId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.generatingPdf.set(false);
        this.snack.open(err?.error?.message ?? 'PDF generation failed.', 'Dismiss', { duration: 3000 });
      },
    });
  }
}
