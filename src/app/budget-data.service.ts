import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Unsubscribe,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase.config';
import {
  DEFAULT_BUDGETS,
  type BudgetCategory,
  type BudgetState,
  type Transaction,
  type UserProfile,
} from './budget.models';

@Injectable({ providedIn: 'root' })
export class BudgetDataService {
  private readonly app = initializeApp(firebaseConfig);
  private readonly auth = getAuth(this.app);
  private readonly db = getFirestore(this.app);

  constructor() {
    void setPersistence(this.auth, browserLocalPersistence);
  }

  watchAuth(callback: (state: BudgetState | null) => void, onError: (message: string) => void): Unsubscribe {
    return onAuthStateChanged(this.auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          callback(null);
          return;
        }

        callback(await this.loadUserState(firebaseUser.uid));
      } catch (error) {
        onError(this.readError(error));
      }
    });
  }

  async login(email: string, password: string): Promise<BudgetState> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    return this.loadUserState(credential.user.uid);
  }

  async register(name: string, email: string, password: string): Promise<BudgetState> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    const profile = { name, email };

    await setDoc(this.userDoc(credential.user.uid), {
      ...profile,
      createdAt: new Date().toISOString(),
    });

    await Promise.all(
      DEFAULT_BUDGETS.map((budget) =>
        setDoc(this.budgetDoc(credential.user.uid, budget.id), this.toStoredBudget(budget))
      )
    );

    return {
      user: profile,
      budgets: [...DEFAULT_BUDGETS],
      transactions: [],
    };
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    const uid = this.requireUid();
    await updateDoc(this.userDoc(uid), {
      name: profile.name,
      email: profile.email,
      updatedAt: new Date().toISOString(),
    });

    if (this.auth.currentUser) {
      await updateProfile(this.auth.currentUser, { displayName: profile.name });
    }
  }

  async addTransaction(transaction: Omit<Transaction, 'id'>): Promise<Transaction> {
    const uid = this.requireUid();
    const docRef = await addDoc(this.transactionsCollection(uid), transaction);
    return { ...transaction, id: docRef.id };
  }

  async updateTransaction(transaction: Transaction): Promise<void> {
    const uid = this.requireUid();
    await updateDoc(this.transactionDoc(uid, transaction.id), this.toStoredTransaction(transaction));
  }

  async deleteTransaction(id: string): Promise<void> {
    const uid = this.requireUid();
    await deleteDoc(this.transactionDoc(uid, id));
  }

  async addBudgetCategory(budget: Omit<BudgetCategory, 'id'>): Promise<BudgetCategory> {
    const uid = this.requireUid();
    const docRef = await addDoc(this.budgetsCollection(uid), budget);
    return { ...budget, id: docRef.id };
  }

  async updateBudgetCategory(budget: BudgetCategory): Promise<void> {
    const uid = this.requireUid();
    await updateDoc(this.budgetDoc(uid, budget.id), this.toStoredBudget(budget));
  }

  async deleteBudgetCategory(id: string): Promise<void> {
    const uid = this.requireUid();
    await deleteDoc(this.budgetDoc(uid, id));
  }

  private async loadUserState(uid: string): Promise<BudgetState> {
    const [userSnapshot, budgetSnapshots, transactionSnapshots] = await Promise.all([
      getDoc(this.userDoc(uid)),
      getDocs(this.budgetsCollection(uid)),
      getDocs(this.transactionsCollection(uid)),
    ]);

    const authUser = this.auth.currentUser;
    const userData = userSnapshot.data() as Partial<UserProfile> | undefined;
    const user = {
      name: userData?.name ?? authUser?.displayName ?? 'Budget User',
      email: userData?.email ?? authUser?.email ?? '',
    };

    if (!userSnapshot.exists()) {
      await setDoc(this.userDoc(uid), {
        ...user,
        createdAt: new Date().toISOString(),
      });
    }

    let budgets = budgetSnapshots.docs.map((budget) => ({
      id: budget.id,
      ...(budget.data() as Omit<BudgetCategory, 'id'>),
    }));

    if (!budgets.length) {
      await Promise.all(
        DEFAULT_BUDGETS.map((budget) =>
          setDoc(this.budgetDoc(uid, budget.id), this.toStoredBudget(budget))
        )
      );
      budgets = [...DEFAULT_BUDGETS];
    }

    return {
      user,
      budgets,
      transactions: transactionSnapshots.docs.map((transaction) => ({
        id: transaction.id,
        ...(transaction.data() as Omit<Transaction, 'id'>),
      })),
    };
  }

  private userDoc(uid: string) {
    return doc(this.db, `users/${uid}`);
  }

  private budgetsCollection(uid: string) {
    return collection(this.db, `users/${uid}/budgets`);
  }

  private budgetDoc(uid: string, id: string) {
    return doc(this.db, `users/${uid}/budgets/${id}`);
  }

  private transactionsCollection(uid: string) {
    return collection(this.db, `users/${uid}/transactions`);
  }

  private transactionDoc(uid: string, id: string) {
    return doc(this.db, `users/${uid}/transactions/${id}`);
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('You must be signed in to save budget data.');
    }

    return uid;
  }

  private toStoredBudget(budget: BudgetCategory): Omit<BudgetCategory, 'id'> {
    return {
      name: budget.name,
      limit: budget.limit,
      color: budget.color,
    };
  }

  private toStoredTransaction(transaction: Transaction): Omit<Transaction, 'id'> {
    return {
      type: transaction.type,
      amount: transaction.amount,
      category: transaction.category,
      date: transaction.date,
      description: transaction.description,
      notes: transaction.notes,
    };
  }

  private readError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Something went wrong while connecting to Firebase.';
  }
}
