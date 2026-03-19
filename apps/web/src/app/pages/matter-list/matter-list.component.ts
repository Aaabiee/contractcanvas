import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatterService, Matter } from '../../services/matter.service';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-matter-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './matter-list.component.html',
  styleUrls: ['./matter-list.component.css'],
})
export class MatterListComponent implements OnInit {
  private matterService = inject(MatterService);

  matters = signal<Matter[]>([]);
  total   = signal(0);
  loading = signal(false);
  error   = signal('');

  ngOnInit(): void {
    this.loading.set(true);
    this.matterService.getMatters({ limit: 50 }).pipe(
      catchError(err => {
        console.error('Error fetching matters:', err);
        this.error.set('Could not load matters. Please try again later.');
        return of({ data: [], total: 0, limit: 50, offset: 0 });
      })
    ).subscribe(page => {
      this.matters.set(page.data);
      this.total.set(page.total);
      this.loading.set(false);
    });
  }
}
