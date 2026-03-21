import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface UpgradeDialogData {
  error:   string;
  limit?:  number;
  current?: number;
}

@Component({
  selector: 'app-upgrade-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, RouterLink],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="warn-icon">upgrade</mat-icon>
      Upgrade Required
    </h2>
    <mat-dialog-content>
      <p>You've reached the limit for your current plan.</p>
      <div *ngIf="data.limit != null" class="usage-bar">
        <div class="usage-label">{{ data.current ?? 0 }} / {{ data.limit }} used</div>
        <div class="bar">
          <div class="fill" [style.width.%]="usagePercent()"></div>
        </div>
      </div>
      <p>Upgrade to a higher tier to unlock more capacity.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Later</button>
      <button mat-flat-button color="primary" [routerLink]="['/billing']" mat-dialog-close>
        <mat-icon>credit_card</mat-icon> View Plans
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .warn-icon { color: #f57c00; vertical-align: middle; margin-right: 6px; }
    .usage-bar { margin: 12px 0; }
    .usage-label { font-size: 13px; margin-bottom: 4px; color: #555; }
    .bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }
    .fill { height: 100%; background: #f57c00; border-radius: 4px; transition: width .3s; }
  `],
})
export class UpgradeDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<UpgradeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: UpgradeDialogData,
  ) {}

  usagePercent(): number {
    if (!this.data.limit) return 100;
    return Math.min(100, ((this.data.current ?? 0) / this.data.limit) * 100);
  }
}
