import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Contract {
  id: string;
  title: string;
  status: 'DRAFT' | 'NEGOTIATION' | 'PENDING_SIGNATURE' | 'EXECUTED' | 'ARCHIVED';
  matterId?: string | null;
  valueCents?: number | null;
  currency?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractVersion {
  id: string;
  contractId: string;
  versionNumber: number;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  title?: string | null;
  createdAt?: string;
  authorId?: string | null;
}

export interface CreateContractDto {
  title: string;
  matterId?: string;
  valueCents?: number;
  currency?: string;
}

export interface UpdateContractDto {
  title?: string;
  status?: Contract['status'];
  valueCents?: number;
  currency?: string;
}

export interface AddVersionDto {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  title?: string;
}

@Injectable({ providedIn: 'root' })
export class ContractService {
  private http = inject(HttpClient);
  private apiUrl = '/api/contracts';

  getContracts(matterId?: string): Observable<Contract[]> {
    const params = matterId ? { matterId } : {};
    return this.http.get<Contract[]>(this.apiUrl, { params });
  }

  getContract(id: string): Observable<Contract> {
    return this.http.get<Contract>(`${this.apiUrl}/${id}`);
  }

  createContract(data: CreateContractDto): Observable<Contract> {
    return this.http.post<Contract>(this.apiUrl, data);
  }

  updateContract(id: string, data: UpdateContractDto): Observable<Contract> {
    return this.http.patch<Contract>(`${this.apiUrl}/${id}`, data);
  }

  deleteContract(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getVersions(contractId: string): Observable<ContractVersion[]> {
    return this.http.get<ContractVersion[]>(`${this.apiUrl}/${contractId}/versions`);
  }

  addVersion(contractId: string, data: AddVersionDto): Observable<ContractVersion> {
    return this.http.post<ContractVersion>(`${this.apiUrl}/${contractId}/versions`, data);
  }
}
