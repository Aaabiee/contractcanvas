import * as Sentry from '@sentry/angular';

const SENTRY_DSN = (window as any).__SENTRY_DSN__ || '';
if (SENTRY_DSN) {
  Sentry.init({
    dsn:              SENTRY_DSN,
    environment:      (window as any).__ENV__ || 'production',
    tracesSampleRate: 0.1,
    integrations:     [Sentry.browserTracingIntegration()],
  });
}

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
