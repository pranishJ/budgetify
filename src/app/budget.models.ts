export type TransactionType = 'income' | 'expense';

export interface UserProfile {
  name: string;
  email: string;
}

export interface BudgetCategory {
  id: string;
  name: string;
  limit: number;
  color: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  description: string;
  notes: string;
}

export interface BudgetState {
  user: UserProfile;
  budgets: BudgetCategory[];
  transactions: Transaction[];
}

export const DEFAULT_BUDGETS: BudgetCategory[] = [
  { id: 'groceries', name: 'Groceries', limit: 620, color: '#15a377' },
  { id: 'utilities', name: 'Utilities', limit: 380, color: '#4777d9' },
  { id: 'transportation', name: 'Transportation', limit: 420, color: '#e6a425' },
  { id: 'dining-out', name: 'Dining Out', limit: 280, color: '#e65757' },
  { id: 'entertainment', name: 'Entertainment', limit: 250, color: '#8b5fbf' },
  { id: 'health', name: 'Health', limit: 260, color: '#2795a7' },
];
