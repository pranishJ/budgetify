import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { BudgetDataService } from './budget-data.service';
import { DEFAULT_BUDGETS, type BudgetState, type UserProfile } from './budget.models';

class MockBudgetDataService {
  private state: BudgetState | null = null;

  watchAuth(callback: (state: BudgetState | null) => void): () => void {
    callback(this.state);
    return () => undefined;
  }

  async login(email: string): Promise<BudgetState> {
    this.state = {
      user: { name: 'Budget User', email },
      budgets: DEFAULT_BUDGETS,
      transactions: [],
    };
    return this.state;
  }

  async register(name: string, email: string): Promise<BudgetState> {
    this.state = {
      user: { name, email },
      budgets: DEFAULT_BUDGETS,
      transactions: [],
    };
    return this.state;
  }

  async logout(): Promise<void> {
    this.state = null;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    if (this.state) {
      this.state = { ...this.state, user: profile };
    }
  }
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: BudgetDataService, useClass: MockBudgetDataService }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Budgetify');
  });

  it('should show dashboard after login', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.componentInstance.login();
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Dashboard');
    expect(compiled.textContent).toContain('Budget Overview');
  });

  it('should start registered users with no transactions', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.registerForm = {
      name: 'New User',
      email: 'new@example.com',
      password: 'budget123',
      confirmPassword: 'budget123',
    };
    await app.register();

    expect(app.transactions()).toEqual([]);
  });
});
