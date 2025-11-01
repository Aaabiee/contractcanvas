// apps/web/src/app/pages/matter-list/matter-list.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatterService, Matter } from '../../services/matter.service';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-matter-list',
  standalone: true,
  imports: [CommonModule, RouterLink], // Add RouterLink for navigation
  templateUrl: './matter-list.component.html',
  styleUrls: ['./matter-list.component.css']
})
export class MatterListComponent implements OnInit {
  private matterService = inject(MatterService);

  public matters$!: Observable<Matter[]>;
  public error: string = '';

  ngOnInit(): void {
    this.matters$ = this.matterService.getMatters().pipe(
      catchError(err => {
        console.error('Error fetching matters:', err);
        this.error = 'Could not load matters. Please try again later.';
        return of([]); // Return an empty array to keep the stream alive
      })
    );
  }
}