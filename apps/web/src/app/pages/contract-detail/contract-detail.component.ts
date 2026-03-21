import { Component, inject, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ContractService, Contract, ContractVersion } from '../../services/contract.service';
import { CommentsComponent } from '../../components/comments/comments.component';
import { Observable, of, forkJoin } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

export interface ContractWithVersions {
  contract: Contract;
  versions: ContractVersion[];
}

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, CommentsComponent, CurrencyPipe],
  providers: [CurrencyPipe],
  templateUrl: './contract-detail.component.html',
  styleUrls: ['./contract-detail.component.css'],
})
export class ContractDetailComponent implements OnInit {
  private contractService = inject(ContractService);
  private route = inject(ActivatedRoute);

  data$!: Observable<ContractWithVersions | null>;
  error = '';

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (!id) {
          this.error = 'No Contract ID provided in URL.';
          return of(null);
        }
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
}
