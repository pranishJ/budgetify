import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BudgetDataService } from './budget-data.service';
import {
  DEFAULT_BUDGETS,
  type BudgetCategory,
  type BudgetState,
  type Transaction,
  type TransactionType,
  type UserProfile,
} from './budget.models';

type View = 'dashboard' | 'transactions' | 'add' | 'budgets' | 'reports' | 'settings';
type AuthMode = 'login' | 'register';

const today = new Date();
const isoDate = (daysAgo = 0): string => {
  const date = new Date(today);
  date.setDate(today.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  private readonly budgetData = inject(BudgetDataService);
  private authUnsubscribe = (): void => undefined;

  readonly authMode = signal<AuthMode>('login');
  readonly activeView = signal<View>('dashboard');
  readonly currentUser = signal<UserProfile | null>(null);
  readonly budgets = signal<BudgetCategory[]>(DEFAULT_BUDGETS);
  readonly transactions = signal<Transaction[]>([]);
  readonly editingId = signal<string | null>(null);
  readonly pendingDeleteId = signal<string | null>(null);
  readonly isBusy = signal(true);
  readonly statusMessage = signal('');

  loginForm = {
    email: 'demo@budgetify.app',
    password: 'budget123',
    remember: true,
  };

  registerForm = {
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  };

  profileForm: UserProfile = {
    name: 'Budget User',
    email: 'demo@budgetify.app',
  };

  transactionForm: Transaction = this.emptyTransaction();
  editForm: Transaction = this.emptyTransaction();

  filters = {
    category: 'All',
    startDate: '',
    endDate: '',
    sort: 'date-desc',
    query: '',
  };

  reportFilters = {
    category: 'All',
    startDate: '',
    endDate: '',
  };

  newBudget = {
    name: '',
    limit: 100,
    color: '#15a377',
  };

  readonly totalIncome = computed(() =>
    this.transactions()
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + transaction.amount, 0)
  );

  readonly totalExpenses = computed(() =>
    this.transactions()
      .filter((transaction) => transaction.type === 'expense')
      .reduce((sum, transaction) => sum + transaction.amount, 0)
  );

  readonly balance = computed(() => this.totalIncome() - this.totalExpenses());

  readonly recentTransactions = computed(() =>
    [...this.transactions()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5)
  );

  readonly budgetOverview = computed(() =>
    this.budgets().map((budget) => {
      const spent = this.categorySpend(budget.name);
      return {
        ...budget,
        spent,
        remaining: budget.limit - spent,
        percent: Math.min((spent / budget.limit) * 100, 100),
        over: spent > budget.limit,
      };
    })
  );

  readonly spendingSlices = computed(() => {
    const expenses = this.transactions().filter((transaction) => transaction.type === 'expense');
    const total = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
    return this.budgets()
      .map((budget) => {
        const spent = this.categorySpend(budget.name);
        return {
          name: budget.name,
          spent,
          color: budget.color,
          percent: total > 0 ? (spent / total) * 100 : 0,
        };
      })
      .filter((slice) => slice.spent > 0);
  });

  readonly spendingChart = computed(() => {
    const slices = this.spendingSlices();
    if (!slices.length) {
      return 'conic-gradient(#d7dde8 0deg 360deg)';
    }

    let cursor = 0;
    const stops = slices.map((slice) => {
      const start = cursor;
      cursor += (slice.percent / 100) * 360;
      return `${slice.color} ${start}deg ${cursor}deg`;
    });

    return `conic-gradient(${stops.join(', ')})`;
  });

  constructor() {
    this.authUnsubscribe = this.budgetData.watchAuth(
      (state) => {
        if (state) {
          this.applyState(state);
        } else {
          this.resetState();
        }
        this.isBusy.set(false);
      },
      (message) => {
        this.statusMessage.set(message);
        this.isBusy.set(false);
      }
    );
  }

  ngOnDestroy(): void {
    this.authUnsubscribe();
  }

  get viewTitle(): string {
    const labels: Record<View, string> = {
      dashboard: 'Dashboard',
      transactions: 'Transactions History',
      add: 'Add Transaction',
      budgets: 'Budget Limits',
      reports: 'Reports',
      settings: 'Settings',
    };

    return labels[this.activeView()];
  }

  get categories(): string[] {
    const budgetCategories = this.budgets().map((budget) => budget.name);
    const transactionCategories = this.transactions().map((transaction) => transaction.category);
    return Array.from(new Set([...budgetCategories, ...transactionCategories])).sort();
  }

  get expenseCategories(): string[] {
    return this.budgets().map((budget) => budget.name);
  }

  get filteredTransactions(): Transaction[] {
    return this.filterTransactions(this.transactions(), this.filters);
  }

  get reportTransactions(): Transaction[] {
    return this.filterTransactions(this.transactions(), this.reportFilters);
  }

  get reportSummary() {
    return this.budgets().map((budget) => {
      const amount = this.reportTransactions
        .filter(
          (transaction) =>
            transaction.type === 'expense' && transaction.category === budget.name
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0);

      return {
        ...budget,
        amount,
        percent: this.totalExpenses() > 0 ? (amount / this.totalExpenses()) * 100 : 0,
      };
    });
  }

  setAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
  }

  async login(): Promise<void> {
    const email = this.loginForm.email.trim() || 'demo@budgetify.app';
    await this.runFirebaseAction(async () => {
      const state = await this.budgetData.login(email, this.loginForm.password);
      this.applyState(state);
    });
  }

  async register(): Promise<void> {
    if (
      !this.registerForm.name.trim() ||
      !this.registerForm.email.trim() ||
      this.registerForm.password !== this.registerForm.confirmPassword
    ) {
      this.statusMessage.set('Enter a name, email, and matching passwords.');
      return;
    }

    await this.runFirebaseAction(async () => {
      const state = await this.budgetData.register(
        this.registerForm.name.trim(),
        this.registerForm.email.trim(),
        this.registerForm.password
      );
      this.applyState(state);
    });
  }

  async logout(): Promise<void> {
    await this.runFirebaseAction(async () => {
      await this.budgetData.logout();
      this.resetState();
    });
  }

  switchView(view: View): void {
    this.activeView.set(view);
    this.editingId.set(null);
    this.pendingDeleteId.set(null);
  }

  async addTransaction(): Promise<void> {
    if (!this.transactionForm.description.trim() || this.transactionForm.amount <= 0) {
      return;
    }

    await this.runFirebaseAction(async () => {
      const savedTransaction = await this.budgetData.addTransaction({
        type: this.transactionForm.type,
        amount: Number(this.transactionForm.amount),
        category: this.transactionForm.category,
        date: this.transactionForm.date,
        description: this.transactionForm.description.trim(),
        notes: this.transactionForm.notes.trim(),
      });
      this.transactions.update((transactions) => [savedTransaction, ...transactions]);
      this.transactionForm = this.emptyTransaction();
      this.activeView.set('transactions');
    });
  }

  startEdit(transaction: Transaction): void {
    this.editingId.set(transaction.id);
    this.pendingDeleteId.set(null);
    this.editForm = { ...transaction };
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId();
    if (!id || !this.editForm.description.trim() || this.editForm.amount <= 0) {
      return;
    }

    await this.runFirebaseAction(async () => {
      const updatedTransaction = { ...this.editForm, id, amount: Number(this.editForm.amount) };
      await this.budgetData.updateTransaction(updatedTransaction);
      this.transactions.update((transactions) =>
        transactions.map((transaction) =>
          transaction.id === id ? updatedTransaction : transaction
        )
      );
      this.editingId.set(null);
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  requestDelete(id: string): void {
    this.pendingDeleteId.set(id);
  }

  cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  async deleteTransaction(): Promise<void> {
    const id = this.pendingDeleteId();
    if (!id) {
      return;
    }

    await this.runFirebaseAction(async () => {
      await this.budgetData.deleteTransaction(id);
      this.transactions.update((transactions) =>
        transactions.filter((transaction) => transaction.id !== id)
      );
      this.pendingDeleteId.set(null);
      if (this.editingId() === id) {
        this.editingId.set(null);
      }
    });
  }

  async addBudgetCategory(): Promise<void> {
    if (!this.newBudget.name.trim() || this.newBudget.limit <= 0) {
      return;
    }

    await this.runFirebaseAction(async () => {
      const savedBudget = await this.budgetData.addBudgetCategory({
        name: this.newBudget.name.trim(),
        limit: Number(this.newBudget.limit),
        color: this.newBudget.color,
      });
      this.budgets.update((budgets) => [...budgets, savedBudget]);
      this.newBudget = { name: '', limit: 100, color: '#15a377' };
    });
  }

  async updateBudgetLimit(id: string, value: string): Promise<void> {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }

    const updatedBudget = this.budgets().find((budget) => budget.id === id);
    if (!updatedBudget) {
      return;
    }

    this.budgets.update((budgets) =>
      budgets.map((budget) => (budget.id === id ? { ...budget, limit } : budget))
    );
    await this.runFirebaseAction(async () => {
      await this.budgetData.updateBudgetCategory({ ...updatedBudget, limit });
    });
  }

  async removeBudget(id: string): Promise<void> {
    await this.runFirebaseAction(async () => {
      await this.budgetData.deleteBudgetCategory(id);
      this.budgets.update((budgets) => budgets.filter((budget) => budget.id !== id));
    });
  }

  async saveProfile(): Promise<void> {
    if (!this.profileForm.name.trim() || !this.profileForm.email.trim()) {
      return;
    }

    const profile = {
      name: this.profileForm.name.trim(),
      email: this.profileForm.email.trim(),
    };

    await this.runFirebaseAction(async () => {
      await this.budgetData.saveProfile(profile);
      this.currentUser.set(profile);
      this.profileForm = { ...profile };
    });
  }

  transactionById(id: string | null): Transaction | undefined {
    return this.transactions().find((transaction) => transaction.id === id);
  }

  categorySpend(category: string): number {
    return this.transactions()
      .filter((transaction) => transaction.type === 'expense' && transaction.category === category)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(`${value}T00:00:00`));
  }

  private filterTransactions(
    transactions: Transaction[],
    filters: { category: string; startDate: string; endDate: string; sort?: string; query?: string }
  ): Transaction[] {
    const query = filters.query?.trim().toLowerCase() ?? '';

    return transactions
      .filter((transaction) => {
        const matchesCategory =
          filters.category === 'All' || transaction.category === filters.category;
        const matchesStart = !filters.startDate || transaction.date >= filters.startDate;
        const matchesEnd = !filters.endDate || transaction.date <= filters.endDate;
        const matchesQuery =
          !query ||
          transaction.description.toLowerCase().includes(query) ||
          transaction.category.toLowerCase().includes(query);

        return matchesCategory && matchesStart && matchesEnd && matchesQuery;
      })
      .sort((a, b) => {
        switch (filters.sort) {
          case 'date-asc':
            return a.date.localeCompare(b.date);
          case 'amount-desc':
            return b.amount - a.amount;
          case 'amount-asc':
            return a.amount - b.amount;
          default:
            return b.date.localeCompare(a.date);
        }
      });
  }

  private emptyTransaction(): Transaction {
    return {
      id: '',
      type: 'expense',
      amount: 0,
      category: 'Groceries',
      date: isoDate(),
      description: '',
      notes: '',
    };
  }

  private applyState(state: BudgetState): void {
    this.currentUser.set(state.user);
    this.profileForm = { ...state.user };
    this.budgets.set(state.budgets.length ? state.budgets : DEFAULT_BUDGETS);
    this.transactions.set(state.transactions);
    this.activeView.set('dashboard');
    this.statusMessage.set('');
  }

  private resetState(): void {
    this.currentUser.set(null);
    this.authMode.set('login');
    this.profileForm = { name: 'Budget User', email: 'demo@budgetify.app' };
    this.budgets.set(DEFAULT_BUDGETS);
    this.transactions.set([]);
    this.activeView.set('dashboard');
    this.editingId.set(null);
    this.pendingDeleteId.set(null);
  }

  private async runFirebaseAction(action: () => Promise<void>): Promise<void> {
    this.isBusy.set(true);
    this.statusMessage.set('');
    try {
      await action();
    } catch (error) {
      this.statusMessage.set(error instanceof Error ? error.message : 'Firebase request failed.');
    } finally {
      this.isBusy.set(false);
    }
  }
}
