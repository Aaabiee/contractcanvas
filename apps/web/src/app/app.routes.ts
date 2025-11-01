// apps/web/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

// Import your standalone components
import { LoginComponent } from './pages/login/login.component';
import { RegisterComponent } from './pages/register/register.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { MatterListComponent } from './pages/matter-list/matter-list.component';
import { MatterDetailComponent } from './pages/matter-detail/matter-detail.component';

export const routes: Routes = [
  // Public routes
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },

  // Protected routes
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard]
  },
  {
    path: 'matters',
    component: MatterListComponent,
    canActivate: [authGuard]
  },
  {
    path: 'matters/:id',
    component: MatterDetailComponent,
    canActivate: [authGuard]
  },

  // Redirects
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' }
];