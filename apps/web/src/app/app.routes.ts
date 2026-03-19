import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { LoginComponent } from './pages/login/login.component';
import { RegisterComponent } from './pages/register/register.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { MatterListComponent } from './pages/matter-list/matter-list.component';
import { MatterDetailComponent } from './pages/matter-detail/matter-detail.component';
import { ContractListComponent } from './pages/contract-list/contract-list.component';
import { ContractDetailComponent } from './pages/contract-detail/contract-detail.component';
import { TasksComponent } from './pages/tasks/tasks.component';
import { OrganizationSettingsComponent } from './pages/organization-settings/organization-settings.component';
import { BillingComponent } from './pages/billing/billing.component';

export const routes: Routes = [
  { path: 'login',    component: LoginComponent },
  { path: 'register', component: RegisterComponent },

  { path: 'dashboard',                  component: DashboardComponent,              canActivate: [authGuard] },
  { path: 'matters',                    component: MatterListComponent,             canActivate: [authGuard] },
  { path: 'matters/:id',                component: MatterDetailComponent,           canActivate: [authGuard] },
  { path: 'contracts',                  component: ContractListComponent,           canActivate: [authGuard] },
  { path: 'contracts/:id',              component: ContractDetailComponent,         canActivate: [authGuard] },
  { path: 'tasks',                      component: TasksComponent,                  canActivate: [authGuard] },
  { path: 'settings/organization',      component: OrganizationSettingsComponent,   canActivate: [authGuard] },
  { path: 'billing',                    component: BillingComponent,                canActivate: [authGuard] },

  { path: '',  redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' },
];
