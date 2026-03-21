import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { catchError, of } from 'rxjs';
import { AnalyticsService, type AnalyticsOverview, type ContractTrends } from '../../services/analytics.service';

@Component({
  selector: 'app-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideCharts(withDefaultRegisterables())],
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatIconModule, MatButtonToggleModule,
    MatProgressSpinnerModule, MatDividerModule,
    BaseChartDirective,
  ],
  template: `
    <div class="analytics-container">
      <h2><mat-icon>bar_chart</mat-icon> Analytics</h2>

      @if (loading()) {
        <div class="center"><mat-progress-spinner mode="indeterminate" diameter="48"/></div>
      } @else {
        <!-- Stat cards -->
        <section class="stat-grid">
          <mat-card class="stat-card">
            <mat-icon class="stat-icon primary">work</mat-icon>
            <div class="stat-val">{{ totalMatters() }}</div>
            <div class="stat-lbl">Total Matters</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon accent">description</mat-icon>
            <div class="stat-val">{{ totalContracts() }}</div>
            <div class="stat-lbl">Contracts</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon warn">warning</mat-icon>
            <div class="stat-val">{{ overview()?.overdueTaskCount ?? 0 }}</div>
            <div class="stat-lbl">Overdue Tasks</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon primary">storage</mat-icon>
            <div class="stat-val">{{ formatBytes(overview()?.storageBytesUsed ?? 0) }}</div>
            <div class="stat-lbl">Storage Used</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon accent">people</mat-icon>
            <div class="stat-val">{{ overview()?.activeMemberCount ?? 0 }}</div>
            <div class="stat-lbl">Active Members</div>
          </mat-card>
        </section>

        <div class="charts-grid">
          <!-- Matter status doughnut -->
          <mat-card class="chart-card">
            <mat-card-header>
              <mat-card-title>Matters by Status</mat-card-title>
            </mat-card-header>
            <mat-divider/>
            <mat-card-content class="chart-wrap">
              <canvas baseChart [data]="matterDoughnutData()" type="doughnut" [options]="doughnutOpts"></canvas>
            </mat-card-content>
          </mat-card>

          <!-- Contract trends line chart -->
          <mat-card class="chart-card">
            <mat-card-header>
              <mat-card-title>Contract Trends</mat-card-title>
              <span class="spacer"></span>
              <mat-button-toggle-group [(ngModel)]="trendPeriod" (ngModelChange)="loadTrends($event)">
                <mat-button-toggle value="30d">30d</mat-button-toggle>
                <mat-button-toggle value="90d">90d</mat-button-toggle>
                <mat-button-toggle value="1y">1y</mat-button-toggle>
              </mat-button-toggle-group>
            </mat-card-header>
            <mat-divider/>
            <mat-card-content class="chart-wrap">
              <canvas baseChart [data]="trendLineData()" type="line" [options]="lineOpts"></canvas>
            </mat-card-content>
          </mat-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .analytics-container { padding: 16px; max-width: 1200px; margin: 0 auto; }
    h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { display: flex; flex-direction: column; align-items: center; padding: 20px 16px; gap: 4px; }
    .stat-icon { font-size: 36px; width: 36px; height: 36px; }
    .stat-icon.primary { color: #3f51b5; } .stat-icon.accent { color: #ff4081; } .stat-icon.warn { color: #f57c00; }
    .stat-val { font-size: 28px; font-weight: 700; }
    .stat-lbl { font-size: 12px; color: rgba(0,0,0,.54); }
    .charts-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; }
    @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } }
    .chart-card mat-card-content { padding: 16px; }
    .chart-wrap { position: relative; height: 280px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .spacer { flex: 1; }
  `],
})
export class AnalyticsComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading  = signal(true);
  overview = signal<AnalyticsOverview | null>(null);
  trends   = signal<ContractTrends | null>(null);
  trendPeriod: '30d' | '90d' | '1y' = '30d';

  readonly doughnutOpts: ChartOptions<'doughnut'> = { responsive: true, maintainAspectRatio: false };
  readonly lineOpts: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: { x: { type: 'category' }, y: { beginAtZero: true } },
  };

  matterDoughnutData = signal<ChartData<'doughnut'>>({ labels: [], datasets: [] });
  trendLineData      = signal<ChartData<'line'>>({ labels: [], datasets: [] });

  ngOnInit(): void {
    this.analyticsService.getOverview().pipe(catchError(() => of(null))).subscribe(data => {
      this.overview.set(data);
      if (data) this.buildMatterChart(data);
      this.loading.set(false);
    });
    this.loadTrends('30d');
  }

  loadTrends(period: '30d' | '90d' | '1y'): void {
    this.analyticsService.getContractTrends(period).pipe(catchError(() => of(null))).subscribe(data => {
      this.trends.set(data);
      if (data) this.buildTrendChart(data);
    });
  }

  totalMatters(): number {
    return (this.overview()?.mattersByStatus ?? []).reduce((s, m) => s + m.count, 0);
  }

  totalContracts(): number {
    return (this.overview()?.contractsByStatus ?? []).reduce((s, c) => s + c.count, 0);
  }

  private buildMatterChart(data: AnalyticsOverview): void {
    this.matterDoughnutData.set({
      labels:   data.mattersByStatus.map(m => m.status),
      datasets: [{ data: data.mattersByStatus.map(m => m.count), backgroundColor: ['#3f51b5', '#ff4081', '#4caf50'] }],
    });
  }

  private buildTrendChart(data: ContractTrends): void {
    this.trendLineData.set({
      labels:   data.data.map(d => d.week.slice(0, 10)),
      datasets: [{ label: 'Contracts Created', data: data.data.map(d => d.count), fill: false, tension: 0.3, borderColor: '#3f51b5' }],
    });
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
}
