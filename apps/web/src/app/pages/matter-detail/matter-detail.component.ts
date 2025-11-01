// apps/web/src/app/pages/matter-detail/matter-detail.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatterService, Matter } from '../../services/matter.service';
import { Observable, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-matter-detail',
  standalone: true,
  imports: [CommonModule, RouterLink], // Add RouterLink
  templateUrl: './matter-detail.component.html',
  styleUrls: ['./matter-detail.component.css']
})
export class MatterDetailComponent implements OnInit {
  private matterService = inject(MatterService);
  private route = inject(ActivatedRoute); // Inject ActivatedRoute

  public matter$!: Observable<Matter | null>;
  public error: string = '';

  ngOnInit(): void {
    // Read the 'id' param from the URL
    this.matter$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (!id) {
          this.error = 'No Matter ID provided in URL.';
          return of(null); // Return null observable
        }
        // Use the ID to fetch the matter
        return this.matterService.getMatter(id).pipe(
          catchError(err => {
            console.error('Error fetching matter:', err);
            this.error = 'Could not load matter details.';
            return of(null);
          })
        );
      })
    );
  }
}