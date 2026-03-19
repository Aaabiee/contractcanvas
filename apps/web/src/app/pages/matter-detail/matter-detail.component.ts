import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatterService, Matter } from '../../services/matter.service';
import { ContractService, Contract } from '../../services/contract.service';
import { DocumentService, Document } from '../../services/document.service';
import { Observable, of, BehaviorSubject, switchMap, combineLatest, catchError } from 'rxjs';

export interface MatterData {
  matter: Matter;
  contracts: Contract[];
  documents: Document[];
}

@Component({
  selector: 'app-matter-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './matter-detail.component.html',
  styleUrls: ['./matter-detail.component.css'],
})
export class MatterDetailComponent implements OnInit {
  private matterService = inject(MatterService);
  private contractService = inject(ContractService);
  private documentService = inject(DocumentService);
  private route = inject(ActivatedRoute);

  data$!: Observable<MatterData | null>;
  error = '';

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (!id) {
          this.error = 'No Matter ID provided in URL.';
          return of(null);
        }
        return combineLatest({
          matter: this.matterService.getMatter(id),
          contracts: this.contractService.getContracts(id).pipe(catchError(() => of([]))),
          documents: this.documentService.getDocuments(id).pipe(catchError(() => of([]))),
        }).pipe(
          catchError(err => {
            console.error('Error fetching matter:', err);
            this.error = 'Could not load matter details.';
            return of(null);
          })
        );
      })
    );
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
