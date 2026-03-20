import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { LoginComponent } from './pages/login/login.component';
import { RegisterComponent } from './pages/register/register.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { DashboardHomeComponent } from './pages/dashboard/dashboard-home.component';
import { MatterListComponent } from './pages/matter-list/matter-list.component';
import { MatterDetailComponent } from './pages/matter-detail/matter-detail.component';
import { ContractListComponent } from './pages/contract-list/contract-list.component';
import { ContractDetailComponent } from './pages/contract-detail/contract-detail.component';
import { TasksComponent } from './pages/tasks/tasks.component';
import { OrganizationSettingsComponent } from './pages/organization-settings/organization-settings.component';
import { BillingComponent } from './pages/billing/billing.component';
import { DocumentsComponent } from './pages/documents/documents.component';
import { AdminComponent } from './pages/admin/admin.component';

export const routes: Routes = [
  { path: 'login',    component: LoginComponent },
  { path: 'register', component: RegisterComponent },

  {
    path: '',
    component: DashboardComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard',             component: DashboardHomeComponent },
      { path: 'matters',               component: MatterListComponent },
      { path: 'matters/:id',           component: MatterDetailComponent },
      { path: 'contracts',             component: ContractListComponent },
      { path: 'contracts/:id',         component: ContractDetailComponent },
      { path: 'tasks',                 component: TasksComponent },
      { path: 'documents',             component: DocumentsComponent },
      { path: 'billing',               component: BillingComponent },
      { path: 'admin',                 component: AdminComponent },
      { path: 'settings/organization', component: OrganizationSettingsComponent },
      { path: '',                      redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },

  { path: '',   redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' },
];
