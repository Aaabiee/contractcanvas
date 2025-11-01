import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmLogoutData {
  title?: string;
  message?: string;
  logoutLabel?: string;
  cancelLabel?: string;
}

@Component({
  selector: 'app-confirm-logout-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './confirm-logout.dialog.html',
  styleUrls: ['./confirm-logout.dialog.scss'],
})
export class ConfirmLogoutDialogComponent {
  private dialogRef = inject(MatDialogRef<ConfirmLogoutDialogComponent, boolean>);
  // optional data; dialog works without it
  data = inject<ConfirmLogoutData | null>(MAT_DIALOG_DATA, { optional: true }) ?? null;

  get title() {
    return this.data?.title ?? 'Sign out?';
  }

  get message() {
    return this.data?.message ?? 'You will be signed out of your session.';
  }

  get logoutLabel() {
    return this.data?.logoutLabel ?? 'Sign out';
  }

  get cancelLabel() {
    return this.data?.cancelLabel ?? 'Cancel';
  }

  confirm() {
    this.dialogRef.close(true);
  }

  cancel() {
    this.dialogRef.close(false);
  }
}