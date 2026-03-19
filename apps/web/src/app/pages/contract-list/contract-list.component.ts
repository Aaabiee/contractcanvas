import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ContractService, Contract } from '../../services/contract.service';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-contract-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './contract-list.component.html',
  styleUrls: ['./contract-list.component.css'],
})
export class ContractListComponent implements OnInit {
  private contractService = inject(ContractService);

  contracts$!: Observable<Contract[]>;
  error = '';

  ngOnInit(): void {
    this.contracts$ = this.contractService.getContracts().pipe(
      catchError(err => {
        console.error('Error fetching contracts:', err);
        this.error = 'Could not load contracts. Please try again later.';
        return of([]);
      })
    );
  }
}
