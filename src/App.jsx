import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Trash2, X, Wallet, ArrowUpRight, ArrowDownRight, ArrowRightLeft,
  MoreHorizontal, Pencil, Check, Download, Share, Landmark, Banknote, CreditCard, Repeat,
  HandCoins, TrendingUp, TrendingDown, Target, LayoutDashboard, List, User, Users,
  Utensils, Car, Home, Zap, Music, Heart, ShoppingBag, Briefcase, Laptop, Gift, Percent,
  Lock, Copy, MessageCircle, Building2, CheckCheck, Search, ChevronDown, ChevronUp, FileSpreadsheet
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---- storage helpers ---------------------------------------------------
const KEYS = {
  accounts: "finance:accounts",
  transactions: "finance:transactions",
  budgets: "finance:budgets",
  recurring: "finance:recurring",
  debts: "finance:debts",
  debtMembers: "finance:debt_members",
  credentials: "finance:credentials",
};

const DEFAULT_DEBT_MEMBERS = ["Raghib", "Kamil", "Maaz", "Shaahzeb", "Fariya"];

async function loadKey(key, fallback) {
  try {
    const res = await window.storage.get(key, true);
    return res ? JSON.parse(res.value) : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), true);
  } catch {
    // best effort
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => (n < 0 ? "-₹" : "₹") + Math.abs(n).toFixed(2);
const round2 = (n) => Math.round(n * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKeyOf = (dateStr) => (dateStr || todayISO()).slice(0, 7);
const fmtDateShort = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const monthLabel = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};
const daysUntil = (d) => Math.round((new Date(d + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);

function addInterval(dateStr, freq) {
  const d = new Date(dateStr + "T00:00:00");
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "biweekly") d.setDate(d.getDate() + 14);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ACCOUNT_TYPES = [
  { id: "cash", label: "Cash", icon: Banknote, color: "#4C8B5C" },
  { id: "bank", label: "Bank", icon: Landmark, color: "#4A7FB5" },
  { id: "card", label: "Card", icon: CreditCard, color: "#8D6CB0" },
];
const accountTypeInfo = (id) => ACCOUNT_TYPES.find((a) => a.id === id) || ACCOUNT_TYPES[0];

const EXPENSE_CATEGORIES = [
  { name: "Food", color: "#C79A3E", icon: Utensils },
  { name: "Transport", color: "#4C8B5C", icon: Car },
  { name: "Housing", color: "#4A7FB5", icon: Home },
  { name: "Utilities", color: "#B0846B", icon: Zap },
  { name: "Entertainment", color: "#8D6CB0", icon: Music },
  { name: "Health", color: "#C05C4A", icon: Heart },
  { name: "Shopping", color: "#4CA0AE", icon: ShoppingBag },
  { name: "Office", color: "#6B8E4E", icon: Building2 },
  { name: "Other", color: "#8A9186", icon: MoreHorizontal },
];
const INCOME_CATEGORIES = [
  { name: "Salary", color: "#4C8B5C", icon: Briefcase },
  { name: "Freelance", color: "#4CA0AE", icon: Laptop },
  { name: "Gift", color: "#8D6CB0", icon: Gift },
  { name: "Interest", color: "#4A7FB5", icon: Percent },
  { name: "Other", color: "#8A9186", icon: MoreHorizontal },
];
const expCatInfo = (name) => EXPENSE_CATEGORIES.find((c) => c.name === name) || EXPENSE_CATEGORIES.find((c) => c.name === "Other");
const incCatInfo = (name) => INCOME_CATEGORIES.find((c) => c.name === name) || INCOME_CATEGORIES.find((c) => c.name === "Other");
const catInfo = (name, type) => (type === "income" ? incCatInfo(name) : expCatInfo(name));

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" };

function buildDebtMessage(d) {
  const amt = money(d.amount);
  if (d.direction === "owed_to_me") {
    return `Hi ${d.person}, quick reminder — you owe me ${amt}${d.note ? ` for ${d.note}` : ""}. Thanks!`;
  }
  return `Hi ${d.person}, heads up — I owe you ${amt}${d.note ? ` for ${d.note}` : ""}. I'll get you sorted soon.`;
}

function applyTxEffect(accountsArr, tx, sign) {
  return accountsArr.map((a) => {
    if (tx.type === "transfer") {
      if (a.id === tx.accountId) return { ...a, balance: round2(a.balance - sign * tx.amount) };
      if (a.id === tx.toAccountId) return { ...a, balance: round2(a.balance + sign * tx.amount) };
      return a;
    }
    if (a.id !== tx.accountId) return a;
    const delta = tx.type === "income" ? tx.amount : -tx.amount;
    return { ...a, balance: round2(a.balance + sign * delta) };
  });
}

function exportTransactionsToCSV(transactions, accounts) {
  const headers = ["Date", "Type", "Category", "Account", "To Account", "Amount", "Note"];
  const rows = transactions.map((t) => {
    const acc = accounts.find((a) => a.id === t.accountId)?.name || "";
    const toAcc = accounts.find((a) => a.id === t.toAccountId)?.name || "";
    return [
      t.date,
      t.type,
      t.category || "",
      `"${acc}"`,
      `"${toAcc}"`,
      t.amount,
      `"${(t.note || "").replace(/"/g, '""')}"`,
    ];
  });
  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `transactions_${todayISO()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [debts, setDebts] = useState([]);
  const [debtMembers, setDebtMembers] = useState(DEFAULT_DEBT_MEMBERS);
  const [tab, setTab] = useState("dashboard");
  const [quickAddModal, setQuickAddModal] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [iosInstallHint, setIosInstallHint] = useState(false);

  useEffect(() => {
    (async () => {
      const [acc, tx, bud, rec, dbt, members, creds] = await Promise.all([
        loadKey(KEYS.accounts, []),
        loadKey(KEYS.transactions, []),
        loadKey(KEYS.budgets, []),
        loadKey(KEYS.recurring, []),
        loadKey(KEYS.debts, []),
        loadKey(KEYS.debtMembers, DEFAULT_DEBT_MEMBERS),
        loadKey(KEYS.credentials, null),
      ]);
      setAccounts(acc);
      setTransactions(tx);
      setBudgets(bud);
      setRecurring(rec);
      setDebts(dbt);
      setDebtMembers(members && members.length > 0 ? members : DEFAULT_DEBT_MEMBERS);
      setCredentials(creds);
      setUnlocked(sessionStorage.getItem("finance_unlocked") === "1");
      setReady(true);
    })();
  }, []);

  const persistAccounts = useCallback((next) => { setAccounts(next); saveKey(KEYS.accounts, next); }, []);
  const persistTransactions = useCallback((next) => { setTransactions(next); saveKey(KEYS.transactions, next); }, []);
  const persistBudgets = useCallback((next) => { setBudgets(next); saveKey(KEYS.budgets, next); }, []);
  const persistRecurring = useCallback((next) => { setRecurring(next); saveKey(KEYS.recurring, next); }, []);
  const persistDebts = useCallback((next) => { setDebts(next); saveKey(KEYS.debts, next); }, []);
  const persistDebtMembers = useCallback((next) => { setDebtMembers(next); saveKey(KEYS.debtMembers, next); }, []);
  const persistCredentials = useCallback((next) => { setCredentials(next); saveKey(KEYS.credentials, next); }, []);

  const reloadAll = useCallback(async () => {
    const [acc, tx, bud, rec, dbt, members, creds] = await Promise.all([
      loadKey(KEYS.accounts, []),
      loadKey(KEYS.transactions, []),
      loadKey(KEYS.budgets, []),
      loadKey(KEYS.recurring, []),
      loadKey(KEYS.debts, []),
      loadKey(KEYS.debtMembers, DEFAULT_DEBT_MEMBERS),
      loadKey(KEYS.credentials, null),
    ]);
    setAccounts(acc);
    setTransactions(tx);
    setBudgets(bud);
    setRecurring(rec);
    setDebts(dbt);
    setDebtMembers(members && members.length > 0 ? members : DEFAULT_DEBT_MEMBERS);
    setCredentials(creds);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel("finance_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_data" }, () => {
        reloadAll();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, reloadAll]);

  // PWA install banner
  useEffect(() => {
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (isStandalone) return;
    if (localStorage.getItem("financeInstallBannerDismissed") === "1") return;

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallEvent(e);
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    const onInstalled = () => {
      setShowInstallBanner(false);
      setIosInstallHint(false);
      localStorage.setItem("financeInstallBannerDismissed", "1");
    };
    window.addEventListener("appinstalled", onInstalled);

    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    if (isIOS) setIosInstallHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setShowInstallBanner(false);
  }, [installEvent]);

  const dismissInstallBanner = useCallback(() => {
    setShowInstallBanner(false);
    setIosInstallHint(false);
    localStorage.setItem("financeInstallBannerDismissed", "1");
  }, []);

  // Transactions
  const addTransaction = (txData) => {
    const tx = {
      id: uid(),
      date: todayISO(),
      note: "",
      ...txData,
      amount: Math.abs(Number(txData.amount) || 0),
    };
    persistAccounts(applyTxEffect(accounts, tx, +1));
    persistTransactions([tx, ...transactions]);
  };
  const updateTransaction = (oldTx, updates) => {
    let acc = applyTxEffect(accounts, oldTx, -1);
    const newTx = { ...oldTx, ...updates, amount: Math.abs(Number(updates.amount ?? oldTx.amount) || 0) };
    acc = applyTxEffect(acc, newTx, +1);
    persistAccounts(acc);
    persistTransactions(transactions.map((t) => (t.id === oldTx.id ? newTx : t)));
  };
  const deleteTransaction = (tx) => {
    persistAccounts(applyTxEffect(accounts, tx, -1));
    persistTransactions(transactions.filter((t) => t.id !== tx.id));
  };

  // Accounts
  const addAccount = (data) => persistAccounts([...accounts, { id: uid(), balance: 0, ...data }]);
  const updateAccount = (id, updates) => persistAccounts(accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  const deleteAccount = (id) => persistAccounts(accounts.filter((a) => a.id !== id));

  // Budgets
  const upsertBudget = (category, limit) => {
    const exists = budgets.find((b) => b.category === category);
    if (exists) persistBudgets(budgets.map((b) => (b.category === category ? { ...b, limit } : b)));
    else persistBudgets([...budgets, { id: uid(), category, limit }]);
  };
  const deleteBudget = (category) => persistBudgets(budgets.filter((b) => b.category !== category));

  // Recurring bills
  const addRecurring = (data) => persistRecurring([...recurring, { id: uid(), active: true, ...data }]);
  const updateRecurring = (id, updates) => persistRecurring(recurring.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  const deleteRecurring = (id) => persistRecurring(recurring.filter((r) => r.id !== id));
  const markBillPaid = (bill) => {
    addTransaction({
      accountId: bill.accountId,
      type: bill.type,
      category: bill.category,
      amount: bill.amount,
      note: bill.name,
      recurringId: bill.id,
      date: todayISO(),
    });
    updateRecurring(bill.id, { nextDue: addInterval(bill.nextDue, bill.frequency) });
  };

  // Debts & Members
  const addDebt = (data) => {
    const cleanPerson = data.person.trim();
    if (!debtMembers.includes(cleanPerson)) {
      persistDebtMembers([...debtMembers, cleanPerson]);
    }
    persistDebts([{ id: uid(), date: todayISO(), settled: false, ...data, person: cleanPerson, amount: Math.abs(Number(data.amount) || 0) }, ...debts]);
  };
  const updateDebt = (id, updates) => persistDebts(debts.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  const deleteDebt = (id) => persistDebts(debts.filter((d) => d.id !== id));

  const addDebtMember = (name) => {
    const clean = name.trim();
    if (!clean || debtMembers.includes(clean)) return;
    persistDebtMembers([...debtMembers, clean]);
  };
  const removeDebtMember = (name) => {
    persistDebtMembers(debtMembers.filter((m) => m !== name));
  };
  const settleAllWithMember = (person) => {
    persistDebts(debts.map((d) => (d.person.toLowerCase() === person.toLowerCase() ? { ...d, settled: true } : d)));
  };

  // Summaries
  const netWorth = round2(accounts.reduce((s, a) => s + a.balance, 0));
  const thisMonth = monthKeyOf(todayISO());
  const monthTx = transactions.filter((t) => monthKeyOf(t.date) === thisMonth);
  const monthIncome = round2(monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));
  const monthExpense = round2(monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const owedToMe = round2(debts.filter((d) => d.direction === "owed_to_me" && !d.settled).reduce((s, d) => s + d.amount, 0));
  const iOwe = round2(debts.filter((d) => d.direction === "i_owe" && !d.settled).reduce((s, d) => s + d.amount, 0));

  if (!ready) return <LoadingScreen />;
  if (!credentials) return <PinSetup onDone={(hash) => persistCredentials({ pinHash: hash })} />;
  if (!unlocked) {
    return (
      <PinUnlock
        credentials={credentials}
        onUnlock={() => {
          sessionStorage.setItem("finance_unlocked", "1");
          setUnlocked(true);
        }}
      />
    );
  }

  return (
    <div style={{ background: "#F7F8F5", minHeight: "100vh" }}>
      <GlobalStyle />
      {(showInstallBanner || iosInstallHint) && (
        <InstallBanner
          onInstall={showInstallBanner ? handleInstallClick : null}
          onDismiss={dismissInstallBanner}
          ios={!showInstallBanner && iosInstallHint}
        />
      )}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-28 pt-6 sm:pt-8">
        <Header tab={tab} setTab={setTab} netWorth={netWorth} overdueBills={recurring.filter((r) => r.active && daysUntil(r.nextDue) < 0).length} />

        {tab === "dashboard" && (
          <DashboardTab
            accounts={accounts}
            transactions={transactions}
            budgets={budgets}
            recurring={recurring}
            debts={debts}
            netWorth={netWorth}
            monthIncome={monthIncome}
            monthExpense={monthExpense}
            owedToMe={owedToMe}
            iOwe={iOwe}
            setTab={setTab}
          />
        )}
        {tab === "accounts" && (
          <AccountsTab accounts={accounts} addAccount={addAccount} updateAccount={updateAccount} deleteAccount={deleteAccount} />
        )}
        {tab === "transactions" && (
          <TransactionsTab
            accounts={accounts}
            transactions={transactions}
            addTransaction={addTransaction}
            updateTransaction={updateTransaction}
            deleteTransaction={deleteTransaction}
          />
        )}
        {tab === "budgets" && (
          <BudgetsTab budgets={budgets} monthTx={monthTx} upsertBudget={upsertBudget} deleteBudget={deleteBudget} />
        )}
        {tab === "bills" && (
          <BillsTab accounts={accounts} recurring={recurring} addRecurring={addRecurring} updateRecurring={updateRecurring} deleteRecurring={deleteRecurring} markBillPaid={markBillPaid} />
        )}
        {tab === "debts" && (
          <DebtsTab
            debts={debts}
            members={debtMembers}
            owedToMe={owedToMe}
            iOwe={iOwe}
            addDebt={addDebt}
            updateDebt={updateDebt}
            deleteDebt={deleteDebt}
            addMember={addDebtMember}
            removeMember={removeDebtMember}
            settleAllWithMember={settleAllWithMember}
          />
        )}
        {tab === "reports" && <ReportsTab transactions={transactions} accounts={accounts} />}
      </div>

      {/* Floating Action Button for Quick Add on any screen */}
      <button
        onClick={() => setQuickAddModal(true)}
        className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full text-white shadow-xl hover:scale-105 transition-all z-40"
        style={{ background: "#1F2A1D" }}
      >
        <Plus size={18} />
        <span className="text-xs font-bold font-display">Log Expense / Debt</span>
      </button>

      {/* Global Quick Add Modal */}
      {quickAddModal && (
        <QuickAddModal
          accounts={accounts}
          members={debtMembers}
          onClose={() => setQuickAddModal(false)}
          onAddTx={addTransaction}
          onAddDebt={addDebt}
        />
      )}
    </div>
  );
}

// ---- chrome & utility elements -------------------------------------------

function LoadingScreen() {
  return (
    <div style={{ background: "#F7F8F5", minHeight: "100vh" }} className="flex items-center justify-center">
      <GlobalStyle />
      <div style={{ color: "#8A9186", fontSize: 13 }}>Loading…</div>
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
      * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
      .font-display { font-family: 'Manrope', sans-serif; }
      input, select { outline: none; }
      input:focus, select:focus { box-shadow: 0 0 0 3px rgba(76,139,92,0.15); border-color: #4C8B5C !important; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: #DCE0D6; border-radius: 4px; }
      .card-hover { transition: box-shadow .15s ease, transform .15s ease; }
      .card-hover:hover { box-shadow: 0 6px 20px rgba(31,42,29,0.08); transform: translateY(-1px); }
    `}</style>
  );
}

function AuthShell({ children }) {
  return (
    <div style={{ background: "#F7F8F5", minHeight: "100vh" }} className="flex items-center justify-center px-4">
      <GlobalStyle />
      <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 16, padding: 28, maxWidth: 380, width: "100%", boxShadow: "0 4px 16px rgba(31,42,29,0.06)" }}>
        {children}
      </div>
    </div>
  );
}

function PinSetup({ onDone }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 4) { setError("Use at least 4 digits."); return; }
    if (pin !== confirm) { setError("PINs don't match."); return; }
    setBusy(true);
    const hash = await hashPin(pin);
    onDone(hash);
  };

  return (
    <AuthShell>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1F2A1D", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Lock size={18} color="#F7F8F5" />
      </div>
      <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Set a PIN</h1>
      <div style={{ color: "#8A9186", fontSize: 13, marginBottom: 18 }}>
        Personal money manager — set a PIN to keep your records private on this device.
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <FieldInput type="password" inputMode="numeric" placeholder="New PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <FieldInput type="password" inputMode="numeric" placeholder="Confirm PIN" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      {error && <div style={{ color: "#C05C4A", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button disabled={busy} onClick={submit} className="w-full" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 13.5, opacity: busy ? 0.6 : 1 }}>
        Set PIN
      </button>
    </AuthShell>
  );
}

function PinUnlock({ credentials, onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    const hash = await hashPin(pin);
    if (hash === credentials.pinHash) onUnlock();
    else { setError("Incorrect PIN."); setPin(""); }
  };

  return (
    <AuthShell>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1F2A1D", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <Lock size={18} color="#F7F8F5" />
      </div>
      <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 22, fontWeight: 800, marginBottom: 14 }}>Enter your PIN</h1>
      <div className="flex flex-col gap-2 mb-3">
        <FieldInput autoFocus type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      {error && <div style={{ color: "#C05C4A", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button onClick={submit} className="w-full" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 13.5 }}>
        Unlock
      </button>
    </AuthShell>
  );
}

function InstallBanner({ onInstall, onDismiss, ios }) {
  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 999,
        maxWidth: 420, margin: "0 auto",
        background: "#1F2A1D", color: "#F7F8F5", borderRadius: 14,
        padding: "12px 14px", boxShadow: "0 10px 30px rgba(31,42,29,0.35)",
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 8, background: "#4C8B5C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {ios ? <Share size={15} color="#F7F8F5" /> : <Download size={15} color="#F7F8F5" />}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35 }}>
        {ios ? (
          <>Install this app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</>
        ) : (
          <>Install Money Manager for quick access and offline use.</>
        )}
      </div>
      {onInstall && (
        <button onClick={onInstall} style={{ background: "#4C8B5C", color: "#F7F8F5", fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "7px 12px", flexShrink: 0 }}>
          Install
        </button>
      )}
      <button onClick={onDismiss} style={{ color: "#B4BAAD", flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}

function Header({ tab, setTab, netWorth, overdueBills }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "transactions", label: "Transactions", icon: List },
    { id: "debts", label: "Debts", icon: HandCoins },
    { id: "accounts", label: "Accounts", icon: Wallet },
    { id: "budgets", label: "Budgets", icon: Target },
    { id: "bills", label: "Bills", icon: Repeat, badge: overdueBills },
    { id: "reports", label: "Reports", icon: TrendingUp },
  ];
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>
            Money Manager
          </h1>
          <div style={{ color: "#8A9186", fontSize: 12.5, marginTop: 1 }}>Track accounts, debts & daily flow</div>
        </div>
        <div className="card-hover" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 12, padding: "8px 16px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
          <div style={{ color: "#8A9186", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>Net worth</div>
          <div className="font-display" style={{ color: netWorth < 0 ? "#C05C4A" : "#1F2A1D", fontSize: 19, fontWeight: 700 }}>
            {money(netWorth)}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
              style={{
                background: active ? "#1F2A1D" : "#FFFFFF",
                color: active ? "#F7F8F5" : "#4A5247",
                border: `1px solid ${active ? "#1F2A1D" : "#E7E9E2"}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Icon size={14} />
              {label}
              {badge > 0 && (
                <span style={{ background: active ? "#F7F8F5" : "#C05C4A", color: active ? "#1F2A1D" : "#fff", fontSize: 10, borderRadius: 8, padding: "1px 5px", fontWeight: 700 }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div>
      <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div className="font-display" style={{ color: color || "#1F2A1D", fontSize: 19, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2" style={{ color: "#B4BAAD", gridColumn: "1 / -1" }}>
      <Icon size={24} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function FieldInput(props) {
  return <input {...props} style={{ background: "#F7F8F5", color: "#1F2A1D", border: "1px solid #E7E9E2", borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }} />;
}
function FieldSelect(props) {
  return <select {...props} style={{ background: "#F7F8F5", color: "#1F2A1D", border: "1px solid #E7E9E2", borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }} />;
}
function Card({ children, style, className }) {
  return (
    <div className={className} style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, boxShadow: "0 2px 8px rgba(31,42,29,0.04)", ...style }}>
      {children}
    </div>
  );
}
function ProgressBar({ pct, color }) {
  return (
    <div style={{ background: "#EDEFEA", borderRadius: 6, height: 7, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: "100%", borderRadius: 6 }} />
    </div>
  );
}

// ---- Global Quick Add Modal ----------------------------------------------

function QuickAddModal({ accounts, members, onClose, onAddTx, onAddDebt }) {
  const [mode, setMode] = useState("tx"); // 'tx' or 'debt'
  const [txType, setTxType] = useState("expense");
  const [debtDir, setDebtDir] = useState("owed_to_me");
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState(members[0] || "");
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [category, setCategory] = useState("Food");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!amount) return;
    if (mode === "tx") {
      onAddTx({
        accountId,
        type: txType,
        category,
        amount,
        note: note.trim(),
        date: todayISO(),
      });
    } else {
      if (!person) return;
      onAddDebt({
        person,
        amount,
        direction: debtDir,
        note: note.trim(),
      });
    }
    onClose();
  };

  const quickAmounts = [100, 200, 500, 1000];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-slate-100"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-display font-bold text-base text-slate-900">Quick Log</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Tab switcher: Transaction vs Debt */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-3">
          <button
            onClick={() => setMode("tx")}
            className={`flex-1 py-1 text-xs font-semibold rounded ${mode === "tx" ? "bg-white shadow text-slate-800" : "text-slate-500"}`}
          >
            Expense / Income
          </button>
          <button
            onClick={() => setMode("debt")}
            className={`flex-1 py-1 text-xs font-semibold rounded ${mode === "debt" ? "bg-white shadow text-slate-800" : "text-slate-500"}`}
          >
            Debt (IOU)
          </button>
        </div>

        {mode === "tx" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setTxType("expense")}
                className={`flex-1 py-1.5 rounded text-xs font-bold ${txType === "expense" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Expense
              </button>
              <button
                onClick={() => setTxType("income")}
                className={`flex-1 py-1.5 rounded text-xs font-bold ${txType === "income" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Income
              </button>
            </div>
            <FieldSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: "100%" }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </FieldSelect>
            <FieldSelect value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%" }}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setDebtDir("owed_to_me")}
                className={`flex-1 py-1.5 rounded text-xs font-bold ${debtDir === "owed_to_me" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                They owe me
              </button>
              <button
                onClick={() => setDebtDir("i_owe")}
                className={`flex-1 py-1.5 rounded text-xs font-bold ${debtDir === "i_owe" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                I owe them
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {members.map((m) => (
                <button
                  key={m}
                  onClick={() => setPerson(m)}
                  className={`text-xs px-2.5 py-1 rounded-md border flex-shrink-0 font-medium ${person === m ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-600"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <FieldInput
              placeholder="Or enter person name"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        )}

        <div className="mt-3 space-y-2">
          <FieldInput
            type="number"
            placeholder="Amount (₹)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: "100%", fontSize: 16, fontWeight: 700 }}
          />

          <div className="flex gap-1.5">
            {quickAmounts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className="flex-1 bg-slate-100 text-slate-700 py-1 rounded text-xs font-bold"
              >
                +₹{q}
              </button>
            ))}
          </div>

          <FieldInput
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <button
          onClick={submit}
          className="w-full mt-4 bg-slate-900 text-white py-2.5 rounded-lg text-xs font-bold font-display"
        >
          Save Record
        </button>
      </div>
    </div>
  );
}

// ---- Dashboard -----------------------------------------------------------

function DashboardTab({ accounts, transactions, budgets, recurring, netWorth, monthIncome, monthExpense, owedToMe, iOwe, setTab }) {
  const upcoming = recurring
    .filter((r) => r.active)
    .slice()
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
    .slice(0, 5);
  const recent = transactions.slice(0, 6);
  const netThisMonth = round2(monthIncome - monthExpense);

  const budgetRows = budgets
    .map((b) => {
      const spent = round2(
        transactions.filter((t) => t.type === "expense" && t.category === b.category && monthKeyOf(t.date) === monthKeyOf(todayISO())).reduce((s, t) => s + t.amount, 0)
      );
      return { ...b, spent, pct: b.limit > 0 ? (spent / b.limit) * 100 : 0 };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Net worth" value={money(netWorth)} color={netWorth < 0 ? "#C05C4A" : "#1F2A1D"} />
          <StatCard label="Income (mo)" value={money(monthIncome)} color="#4C8B5C" />
          <StatCard label="Expense (mo)" value={money(monthExpense)} color="#C05C4A" />
          <StatCard label="Net (mo)" value={money(netThisMonth)} color={netThisMonth < 0 ? "#C05C4A" : "#4C8B5C"} />
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D" }}>Debts Summary</div>
            <button onClick={() => setTab("debts")} style={{ fontSize: 11.5, color: "#8A9186", textDecoration: "underline" }}>manage debts</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Owed to you" value={money(owedToMe)} color="#4C8B5C" />
            <StatCard label="You owe" value={money(iOwe)} color="#C05C4A" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D" }}>Upcoming bills</div>
            <button onClick={() => setTab("bills")} style={{ fontSize: 11.5, color: "#8A9186", textDecoration: "underline" }}>view all</button>
          </div>
          {upcoming.length === 0 ? (
            <div style={{ color: "#B4BAAD", fontSize: 12.5 }}>No recurring bills due soon.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((r) => {
                const d = daysUntil(r.nextDue);
                const overdue = d < 0;
                return (
                  <div key={r.id} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                    <span style={{ color: "#1F2A1D" }}>{r.name}</span>
                    <span style={{ color: overdue ? "#C05C4A" : "#8A9186", fontWeight: overdue ? 700 : 400 }}>
                      {overdue ? `${Math.abs(d)}d overdue` : d === 0 ? "today" : `in ${d}d`} · {money(r.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {budgetRows.length > 0 && (
        <Card>
          <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D", marginBottom: 10 }}>Budgets this month</div>
          <div className="flex flex-col gap-3">
            {budgetRows.map((b) => {
              const c = expCatInfo(b.category);
              const over = b.pct >= 100;
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
                    <span style={{ color: "#1F2A1D" }}>{b.category}</span>
                    <span style={{ color: over ? "#C05C4A" : "#8A9186" }}>{money(b.spent)} / {money(b.limit)}</span>
                  </div>
                  <ProgressBar pct={b.pct} color={over ? "#C05C4A" : b.pct >= 80 ? "#C79A3E" : c.color} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D" }}>Recent activity</div>
          <button onClick={() => setTab("transactions")} style={{ fontSize: 11.5, color: "#8A9186", textDecoration: "underline" }}>view all</button>
        </div>
        {recent.length === 0 ? (
          <div style={{ color: "#B4BAAD", fontSize: 12.5 }}>No transactions logged yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} accounts={accounts} compact />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TxRow({ tx, accounts, compact, onEdit, onDelete }) {
  const isTransfer = tx.type === "transfer";
  const c = isTransfer ? null : catInfo(tx.category, tx.type);
  const Icon = isTransfer ? ArrowRightLeft : c.icon;
  const accName = (id) => accounts.find((a) => a.id === id)?.name || "Deleted account";
  const color = isTransfer ? "#8A9186" : tx.type === "income" ? "#4C8B5C" : "#C05C4A";
  return (
    <div className="flex items-center gap-3">
      <div style={{ width: 30, height: 30, borderRadius: 8, background: (isTransfer ? "#8A9186" : c.color) + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={14} color={isTransfer ? "#8A9186" : c.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#1F2A1D", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tx.note || (isTransfer ? "Transfer" : tx.category)}
        </div>
        <div style={{ fontSize: 11, color: "#8A9186" }}>
          {isTransfer ? `${accName(tx.accountId)} → ${accName(tx.toAccountId)}` : accName(tx.accountId)} · {fmtDateShort(tx.date)}
        </div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color, flexShrink: 0 }}>
        {isTransfer ? "" : tx.type === "income" ? "+" : "-"}{money(tx.amount).replace("-", "")}
      </div>
      {!compact && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onEdit(tx)} style={{ color: "#8A9186", padding: 4 }}><Pencil size={13} /></button>
          <button onClick={() => onDelete(tx)} style={{ color: "#C05C4A", padding: 4 }}><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

// ---- Accounts --------------------------------------------------------

function AccountsTab({ accounts, addAccount, updateAccount, deleteAccount }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", type: "cash", balance: 0 });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const submitAdd = () => {
    if (!form.name.trim()) return;
    addAccount({ name: form.name.trim(), type: form.type, balance: round2(Number(form.balance) || 0) });
    setForm({ name: "", type: "cash", balance: 0 });
    setAdding(false);
  };
  const startEdit = (a) => { setEditingId(a.id); setEditForm({ ...a }); };
  const saveEdit = () => {
    if (!editForm.name.trim()) return;
    updateAccount(editingId, { name: editForm.name.trim(), type: editForm.type, balance: round2(Number(editForm.balance) || 0) });
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: "#1F2A1D" }}>Accounts</div>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
          <Plus size={14} /> Add account
        </button>
      </div>

      {adding && (
        <Card>
          <div className="grid sm:grid-cols-3 gap-2">
            <FieldInput placeholder="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <FieldSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </FieldSelect>
            <FieldInput type="number" step="0.01" placeholder="Starting balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={submitAdd} style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ color: "#8A9186", fontSize: 13 }}>Cancel</button>
          </div>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.length === 0 && !adding && <EmptyState icon={Wallet} text="No accounts yet — add one to get started." />}
        {accounts.map((a) => {
          const t = accountTypeInfo(a.type);
          const Icon = t.icon;
          const isEditing = editingId === a.id;
          if (isEditing) {
            return (
              <Card key={a.id}>
                <div className="flex flex-col gap-2">
                  <FieldInput value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  <FieldSelect value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                    {ACCOUNT_TYPES.map((ty) => <option key={ty.id} value={ty.id}>{ty.label}</option>)}
                  </FieldSelect>
                  <FieldInput type="number" step="0.01" value={editForm.balance} onChange={(e) => setEditForm({ ...editForm, balance: e.target.value })} />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ color: "#8A9186", fontSize: 12.5 }}>Cancel</button>
                  </div>
                </div>
              </Card>
            );
          }
          return (
            <Card key={a.id} style={{ position: "relative" }} className="card-hover">
              <div className="flex items-center gap-3 mb-3">
                <div style={{ width: 34, height: 34, borderRadius: 9, background: t.color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={16} color={t.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1F2A1D" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "#8A9186" }}>{t.label}</div>
                </div>
              </div>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 700, color: a.balance < 0 ? "#C05C4A" : "#1F2A1D", marginBottom: 8 }}>
                {money(a.balance)}
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(a)} style={{ color: "#8A9186", padding: 4 }}><Pencil size={13} /></button>
                <button onClick={() => deleteAccount(a.id)} style={{ color: "#C05C4A", padding: 4 }}><Trash2 size={13} /></button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Transactions ------------------------------------------------------

function TransactionsTab({ accounts, transactions, addTransaction, updateTransaction, deleteTransaction }) {
  const [type, setType] = useState("expense");
  const [form, setForm] = useState({ accountId: "", toAccountId: "", category: "", amount: "", note: "", date: todayISO() });
  const [search, setSearch] = useState("");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const cats = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const quickPresets = [
    { label: "Chai / Snacks", category: "Food", amount: "50" },
    { label: "Metro / Auto", category: "Transport", amount: "60" },
    { label: "Lunch / Dinner", category: "Food", amount: "250" },
    { label: "Groceries", category: "Shopping", amount: "500" },
  ];

  const submit = () => {
    if (!form.accountId || !form.amount) return;
    if (type === "transfer" && (!form.toAccountId || form.toAccountId === form.accountId)) return;
    addTransaction({
      accountId: form.accountId,
      toAccountId: type === "transfer" ? form.toAccountId : undefined,
      type,
      category: type === "transfer" ? undefined : (form.category || cats[0].name),
      amount: form.amount,
      note: form.note.trim(),
      date: form.date || todayISO(),
    });
    setForm({ accountId: form.accountId, toAccountId: "", category: "", amount: "", note: "", date: todayISO() });
  };

  const startEdit = (t) => { setEditingId(t.id); setEditForm({ ...t, amount: t.amount }); };
  const saveEdit = (oldTx) => {
    updateTransaction(oldTx, {
      accountId: editForm.accountId,
      toAccountId: editForm.type === "transfer" ? editForm.toAccountId : undefined,
      type: editForm.type,
      category: editForm.type === "transfer" ? undefined : editForm.category,
      amount: editForm.amount,
      note: editForm.note,
      date: editForm.date,
    });
    setEditingId(null);
  };

  const visible = useMemo(() => {
    return transactions
      .filter((t) => filterAccount === "all" || t.accountId === filterAccount || t.toAccountId === filterAccount)
      .filter((t) => filterCategory === "all" || t.category === filterCategory)
      .filter((t) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (t.note || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q);
      });
  }, [transactions, filterAccount, filterCategory, search]);

  const visibleExpenseTotal = round2(visible.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const visibleIncomeTotal = round2(visible.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));

  if (accounts.length === 0) {
    return <EmptyState icon={List} text="Add an account first, then you can log transactions." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex gap-2 mb-3">
          {[
            { id: "expense", label: "Expense", icon: ArrowDownRight, color: "#C05C4A" },
            { id: "income", label: "Income", icon: ArrowUpRight, color: "#4C8B5C" },
            { id: "transfer", label: "Transfer", icon: ArrowRightLeft, color: "#4A7FB5" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setType(opt.id); setForm({ ...form, category: "" }); }}
              className="flex items-center gap-1.5"
              style={{ background: type === opt.id ? opt.color : "#F7F8F5", color: type === opt.id ? "#fff" : "#4A5247", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}
            >
              <opt.icon size={13} /> {opt.label}
            </button>
          ))}
        </div>

        {/* Quick Tag Presets */}
        {type === "expense" && (
          <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto pb-1">
            <span style={{ fontSize: 11, color: "#8A9186", flexShrink: 0 }}>Quick:</span>
            {quickPresets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setForm({ ...form, category: p.category, amount: p.amount, note: p.label })}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded text-xs font-semibold flex-shrink-0"
              >
                {p.label} (₹{p.amount})
              </button>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-2 mb-2">
          <FieldSelect value={form.accountId || (accounts[0]?.id ?? "")} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">{type === "transfer" ? "From account" : "Account"}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </FieldSelect>
          {type === "transfer" ? (
            <FieldSelect value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}>
              <option value="">To account</option>
              {accounts.filter((a) => a.id !== (form.accountId || accounts[0]?.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </FieldSelect>
          ) : (
            <FieldSelect value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Category</option>
              {cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
          )}
        </div>
        <div className="grid sm:grid-cols-3 gap-2 mb-3">
          <FieldInput type="number" step="0.01" placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <FieldInput placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <FieldInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <button onClick={submit} style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>
          Add {type}
        </button>
      </Card>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative w-full">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search note or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <FieldSelect value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ width: 140, fontSize: 12 }}>
            <option value="all">All categories</option>
            <optgroup label="Expense">
              {EXPENSE_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Income">
              {INCOME_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </optgroup>
          </FieldSelect>
          <FieldSelect value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} style={{ width: 130, fontSize: 12 }}>
            <option value="all">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </FieldSelect>
          <button
            onClick={() => exportTransactionsToCSV(transactions, accounts)}
            title="Export CSV"
            className="p-2 border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-700"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {(filterAccount !== "all" || filterCategory !== "all" || search) && (
        <Card style={{ padding: "10px 14px" }}>
          <div className="flex items-center gap-4 flex-wrap" style={{ fontSize: 12 }}>
            <span style={{ color: "#8A9186" }}>
              {visible.length} matches
            </span>
            {visibleExpenseTotal > 0 && <span style={{ color: "#C05C4A", fontWeight: 700 }}>Spent: {money(visibleExpenseTotal)}</span>}
            {visibleIncomeTotal > 0 && <span style={{ color: "#4C8B5C", fontWeight: 700 }}>Received: {money(visibleIncomeTotal)}</span>}
          </div>
        </Card>
      )}

      <Card>
        {visible.length === 0 ? (
          <EmptyState icon={List} text="No transactions match your search." />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((t) =>
              editingId === t.id ? (
                <div key={t.id} style={{ borderTop: "1px solid #E7E9E2", paddingTop: 10 }}>
                  <div className="grid sm:grid-cols-2 gap-2 mb-2">
                    <FieldSelect value={editForm.accountId} onChange={(e) => setEditForm({ ...editForm, accountId: e.target.value })}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </FieldSelect>
                    {editForm.type === "transfer" ? (
                      <FieldSelect value={editForm.toAccountId} onChange={(e) => setEditForm({ ...editForm, toAccountId: e.target.value })}>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </FieldSelect>
                    ) : (
                      <FieldSelect value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                        {(editForm.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </FieldSelect>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2 mb-2">
                    <FieldInput type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                    <FieldInput value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
                    <FieldInput type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(t)} style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ color: "#8A9186", fontSize: 12.5 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <TxRow key={t.id} tx={t} accounts={accounts} onEdit={startEdit} onDelete={deleteTransaction} />
              )
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Budgets ------------------------------------------------------------

function BudgetsTab({ budgets, monthTx, upsertBudget, deleteBudget }) {
  const [limitDrafts, setLimitDrafts] = useState({});

  const spentFor = (category) => round2(monthTx.filter((t) => t.type === "expense" && t.category === category).reduce((s, t) => s + t.amount, 0));

  return (
    <div className="flex flex-col gap-4">
      <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: "#1F2A1D" }}>Monthly budgets</div>
      <div className="grid sm:grid-cols-2 gap-4">
        {EXPENSE_CATEGORIES.map((c) => {
          const b = budgets.find((x) => x.category === c.name);
          const spent = spentFor(c.name);
          const pct = b ? (spent / b.limit) * 100 : 0;
          const over = pct >= 100;
          const draft = limitDrafts[c.name] ?? (b ? b.limit : "");
          return (
            <Card key={c.name}>
              <div className="flex items-center gap-2 mb-2">
                <div style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <c.icon size={13} color={c.color} />
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1F2A1D", flex: 1 }}>{c.name}</div>
                {b && <div style={{ fontSize: 12, color: over ? "#C05C4A" : "#8A9186" }}>{money(spent)} / {money(b.limit)}</div>}
              </div>
              {b && <div style={{ marginBottom: 10 }}><ProgressBar pct={pct} color={over ? "#C05C4A" : pct >= 80 ? "#C79A3E" : c.color} /></div>}
              <div className="flex gap-2">
                <FieldInput
                  type="number" step="0.01" placeholder="Monthly limit"
                  value={draft}
                  onChange={(e) => setLimitDrafts({ ...limitDrafts, [c.name]: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => upsertBudget(c.name, round2(Number(draft) || 0))}
                  style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700 }}
                >
                  {b ? "Update" : "Set"}
                </button>
                {b && (
                  <button onClick={() => { deleteBudget(c.name); setLimitDrafts({ ...limitDrafts, [c.name]: "" }); }} style={{ color: "#C05C4A", padding: 8 }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Bills / recurring ---------------------------------------------------

function BillsTab({ accounts, recurring, addRecurring, updateRecurring, deleteRecurring, markBillPaid }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", type: "expense", category: "", accountId: "", amount: "", frequency: "monthly", nextDue: todayISO() });

  const submit = () => {
    if (!form.name.trim() || !form.accountId || !form.amount) return;
    const cats = form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    addRecurring({
      name: form.name.trim(),
      type: form.type,
      category: form.category || cats[0].name,
      accountId: form.accountId,
      amount: round2(Number(form.amount) || 0),
      frequency: form.frequency,
      nextDue: form.nextDue || todayISO(),
    });
    setForm({ name: "", type: "expense", category: "", accountId: form.accountId, amount: "", frequency: "monthly", nextDue: todayISO() });
    setAdding(false);
  };

  const sorted = recurring.slice().sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  if (accounts.length === 0) {
    return <EmptyState icon={Repeat} text="Add an account first, then set up recurring bills." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: "#1F2A1D" }}>Recurring bills & subscriptions</div>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
          <Plus size={14} /> Add bill
        </button>
      </div>

      {adding && (
        <Card>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <FieldInput placeholder="Name (e.g. Netflix, Rent)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <FieldSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: "" })}>
              <option value="expense">Expense (I pay)</option>
              <option value="income">Income (I receive)</option>
            </FieldSelect>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <FieldSelect value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Category</option>
              {(form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
            <FieldSelect value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              <option value="">Account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </FieldSelect>
          </div>
          <div className="grid sm:grid-cols-3 gap-2 mb-3">
            <FieldInput type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <FieldSelect value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {Object.entries(FREQ_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </FieldSelect>
            <FieldInput type="date" value={form.nextDue} onChange={(e) => setForm({ ...form, nextDue: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={submit} style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ color: "#8A9186", fontSize: 13 }}>Cancel</button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {sorted.length === 0 && !adding && <EmptyState icon={Repeat} text="No recurring bills yet." />}
        {sorted.map((r) => {
          const d = daysUntil(r.nextDue);
          const overdue = d < 0;
          const c = catInfo(r.category, r.type);
          const accName = accounts.find((a) => a.id === r.accountId)?.name || "Deleted account";
          return (
            <Card key={r.id} className="card-hover">
              <div className="flex items-center gap-3">
                <div style={{ width: 34, height: 34, borderRadius: 9, background: c.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <c.icon size={16} color={c.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1F2A1D" }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: "#8A9186" }}>
                    {accName} · {FREQ_LABEL[r.frequency]} · <span style={{ color: overdue ? "#C05C4A" : "#8A9186", fontWeight: overdue ? 700 : 400 }}>
                      {overdue ? `${Math.abs(d)}d overdue` : d === 0 ? "due today" : `due in ${d}d`}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: r.type === "income" ? "#4C8B5C" : "#C05C4A", flexShrink: 0 }}>
                  {r.type === "income" ? "+" : "-"}{money(r.amount).replace("-", "")}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => markBillPaid(r)} className="flex items-center gap-1" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>
                  <Check size={12} /> Mark {r.type === "income" ? "received" : "paid"}
                </button>
                <button onClick={() => updateRecurring(r.id, { active: !r.active })} style={{ color: "#8A9186", fontSize: 12 }}>
                  {r.active ? "Pause" : "Resume"}
                </button>
                <button onClick={() => deleteRecurring(r.id)} style={{ color: "#C05C4A", padding: 4, marginLeft: "auto" }}><Trash2 size={13} /></button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Debts / IOUs with Member Support ------------------------------------

function DebtsTab({ debts, members, owedToMe, iOwe, addDebt, updateDebt, deleteDebt, addMember, removeMember, settleAllWithMember }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ person: members[0] || "", amount: "", direction: "owed_to_me", note: "" });
  const [newMemberInput, setNewMemberInput] = useState("");
  const [filterPerson, setFilterPerson] = useState("all");
  const [expandedPerson, setExpandedPerson] = useState(null);
  const [shareFallback, setShareFallback] = useState(null);

  const shareDebt = async (d) => {
    const message = buildDebtMessage(d);
    if (navigator.share) {
      try {
        await navigator.share({ text: message });
      } catch {
        // user cancelled share sheet
      }
    } else {
      setShareFallback({ debt: d, message });
    }
  };

  const submit = () => {
    if (!form.person.trim() || !form.amount) return;
    addDebt({ person: form.person.trim(), amount: form.amount, direction: form.direction, note: form.note.trim() });
    setForm({ person: form.person, amount: "", direction: "owed_to_me", note: "" });
    setAdding(false);
  };

  const handleCreateMember = (e) => {
    e.preventDefault();
    if (!newMemberInput.trim()) return;
    addMember(newMemberInput.trim());
    setNewMemberInput("");
  };

  // Compute breakdown per member
  const memberBalances = members.map((person) => {
    const personDebts = debts.filter((d) => d.person.toLowerCase() === person.toLowerCase() && !d.settled);
    const owedByThem = personDebts.filter((d) => d.direction === "owed_to_me").reduce((s, d) => s + d.amount, 0);
    const iOweThem = personDebts.filter((d) => d.direction === "i_owe").reduce((s, d) => s + d.amount, 0);
    const net = round2(owedByThem - iOweThem);
    return { person, owedByThem, iOweThem, net, count: personDebts.length, items: personDebts };
  });

  const active = debts
    .filter((d) => !d.settled)
    .filter((d) => filterPerson === "all" || d.person.toLowerCase() === filterPerson.toLowerCase());

  const settled = debts
    .filter((d) => d.settled)
    .filter((d) => filterPerson === "all" || d.person.toLowerCase() === filterPerson.toLowerCase());

  const quickAmounts = [100, 200, 500, 1000];

  return (
    <div className="flex flex-col gap-4">
      {/* Top Totals */}
      <Card>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Owed to you" value={money(owedToMe)} color="#4C8B5C" />
          <StatCard label="You owe" value={money(iOwe)} color="#C05C4A" />
          <StatCard label="Net" value={money(round2(owedToMe - iOwe))} color={owedToMe - iOwe < 0 ? "#C05C4A" : "#1F2A1D"} />
        </div>
      </Card>

      {/* Member Cards Grid */}
      <div className="flex items-center justify-between">
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: "#1F2A1D" }}>Members & Balances</div>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {memberBalances.map(({ person, net, count, items }) => (
          <div
            key={person}
            className="card-hover bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm text-slate-800">{person}</span>
                <div className="flex items-center gap-1">
                  {count > 0 && (
                    <button
                      onClick={() => settleAllWithMember(person)}
                      title="Settle all with this member"
                      className="text-emerald-700 hover:text-emerald-800 p-1"
                    >
                      <CheckCheck size={14} />
                    </button>
                  )}
                  {!DEFAULT_DEBT_MEMBERS.includes(person) && count === 0 && (
                    <button onClick={() => removeMember(person)} title="Remove member" className="text-slate-400 hover:text-rose-600 p-1">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-baseline justify-between mt-1.5">
                <span className="text-xs text-slate-400">
                  {net > 0 ? "Owes you" : net < 0 ? "You owe" : "All settled"}
                </span>
                <span
                  className="font-display font-extrabold text-sm"
                  style={{ color: net > 0 ? "#4C8B5C" : net < 0 ? "#C05C4A" : "#8A9186" }}
                >
                  {net === 0 ? "₹0.00" : money(net)}
                </span>
              </div>
            </div>

            {/* Quick Actions & Detail dropdown */}
            <div className="mt-3 pt-2 border-t border-slate-100 flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    setForm({ ...form, person, direction: "owed_to_me" });
                    setAdding(true);
                  }}
                  className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded py-1 text-xs font-bold"
                >
                  + Lent
                </button>
                <button
                  onClick={() => {
                    setForm({ ...form, person, direction: "i_owe" });
                    setAdding(true);
                  }}
                  className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded py-1 text-xs font-bold"
                >
                  + Borrowed
                </button>
              </div>

              {count > 0 && (
                <button
                  onClick={() => setExpandedPerson(expandedPerson === person ? null : person)}
                  className="w-full text-center text-[11px] text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 pt-1"
                >
                  {expandedPerson === person ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {count} open item{count > 1 ? "s" : ""}
                </button>
              )}

              {/* Collapsible item breakdown */}
              {expandedPerson === person && (
                <div className="mt-1 bg-slate-50 p-2 rounded-lg space-y-1.5 text-xs">
                  {items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-slate-700">
                      <span className="truncate pr-1">{it.note || "Unspecified"}</span>
                      <span className={`font-semibold flex-shrink-0 ${it.direction === "owed_to_me" ? "text-emerald-700" : "text-rose-700"}`}>
                        {money(it.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add New Member Input */}
      <form onSubmit={handleCreateMember} className="flex gap-2">
        <FieldInput
          placeholder="Add another member (e.g. Ayman, Faraz)..."
          value={newMemberInput}
          onChange={(e) => setNewMemberInput(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
          + Add Person
        </button>
      </form>

      {/* Filter and Log Bar */}
      <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ fontSize: 12, fontWeight: 600, color: "#8A9186" }}>Filter:</span>
          <button
            onClick={() => setFilterPerson("all")}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${filterPerson === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`}
          >
            All
          </button>
          {members.map((m) => (
            <button
              key={m}
              onClick={() => setFilterPerson(m)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${filterPerson === m ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5"
          style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}
        >
          <Plus size={14} /> Log Debt
        </button>
      </div>

      {/* Add Debt Card */}
      {adding && (
        <Card>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setForm({ ...form, direction: "owed_to_me" })}
              style={{ flex: 1, background: form.direction === "owed_to_me" ? "#4C8B5C" : "#F7F8F5", color: form.direction === "owed_to_me" ? "#fff" : "#4A5247", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700 }}
            >
              They owe me (I Lent)
            </button>
            <button
              onClick={() => setForm({ ...form, direction: "i_owe" })}
              style={{ flex: 1, background: form.direction === "i_owe" ? "#C05C4A" : "#F7F8F5", color: form.direction === "i_owe" ? "#fff" : "#4A5247", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700 }}
            >
              I owe them (I Borrowed)
            </button>
          </div>

          <div className="flex items-center gap-1.5 mb-2 overflow-x-auto py-1">
            <span style={{ fontSize: 11, color: "#8A9186", flexShrink: 0 }}>Select person:</span>
            {members.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ ...form, person: m })}
                style={{
                  background: form.person === m ? "#1F2A1D" : "#F7F8F5",
                  color: form.person === m ? "#fff" : "#4A5247",
                  fontSize: 11.5,
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontWeight: 600,
                  border: "1px solid #E7E9E2",
                  flexShrink: 0,
                }}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <FieldInput
              placeholder="Person's name"
              value={form.person}
              onChange={(e) => setForm({ ...form, person: e.target.value })}
            />
            <FieldInput
              type="number"
              step="0.01"
              placeholder="Amount (₹)"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-1.5 mb-2">
            <span style={{ fontSize: 11, color: "#8A9186" }}>Quick amount:</span>
            {quickAmounts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setForm({ ...form, amount: String(q) })}
                style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", color: "#4A5247", borderRadius: 6, padding: "3px 8px", fontSize: 11.5, fontWeight: 600 }}
              >
                +₹{q}
              </button>
            ))}
          </div>

          <FieldInput
            placeholder="Note (e.g. Biryani, Metro recharge, Chai, Rent)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            style={{ width: "100%", marginBottom: 12 }}
          />

          <div className="flex gap-2">
            <button onClick={submit} style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>
              Save Debt
            </button>
            <button onClick={() => setAdding(false)} style={{ color: "#8A9186", fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </Card>
      )}

      {/* Active List */}
      <Card>
        {active.length === 0 ? (
          <EmptyState icon={HandCoins} text={filterPerson === "all" ? "No open debts." : `No open debts for ${filterPerson}.`} />
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((d) => (
              <div key={d.id} className="flex items-center gap-3">
                <div style={{ width: 32, height: 32, borderRadius: 8, background: (d.direction === "owed_to_me" ? "#4C8B5C" : "#C05C4A") + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User size={15} color={d.direction === "owed_to_me" ? "#4C8B5C" : "#C05C4A"} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1F2A1D" }}>{d.person}</div>
                  <div style={{ fontSize: 11, color: "#8A9186" }}>
                    {d.direction === "owed_to_me" ? "owes you" : "you owe"} · {fmtDateShort(d.date)}{d.note ? ` · ${d.note}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: d.direction === "owed_to_me" ? "#4C8B5C" : "#C05C4A", flexShrink: 0 }}>
                  {money(d.amount)}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => shareDebt(d)} title="Share reminder" style={{ color: "#8A9186", padding: 4 }}><Share size={14} /></button>
                  <button onClick={() => updateDebt(d.id, { settled: true })} title="Mark settled" style={{ color: "#4C8B5C", padding: 4 }}><Check size={14} /></button>
                  <button onClick={() => deleteDebt(d.id)} style={{ color: "#C05C4A", padding: 4 }}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Settled List */}
      {settled.length > 0 && (
        <Card>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8A9186", marginBottom: 8 }}>Settled History</div>
          <div className="flex flex-col gap-2">
            {settled.map((d) => (
              <div key={d.id} className="flex items-center gap-3" style={{ opacity: 0.65 }}>
                <div style={{ flex: 1, fontSize: 12.5, color: "#1F2A1D", textDecoration: "line-through" }}>
                  {d.person} — {money(d.amount)} {d.note ? `(${d.note})` : ""}
                </div>
                <button onClick={() => updateDebt(d.id, { settled: false })} style={{ fontSize: 11, color: "#8A9186", textDecoration: "underline" }}>reopen</button>
                <button onClick={() => deleteDebt(d.id)} style={{ color: "#C05C4A", padding: 4 }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {shareFallback && <ShareFallbackModal data={shareFallback} onClose={() => setShareFallback(null)} />}
    </div>
  );
}

function ShareFallbackModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const { debt, message } = data;
  const waLink = `https://wa.me/?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // best effort
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(31,42,29,0.45)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, padding: 20, maxWidth: 380, width: "100%", boxShadow: "0 10px 40px rgba(31,42,29,0.2)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-display" style={{ fontWeight: 700, fontSize: 15, color: "#1F2A1D" }}>Share with {debt.person}</div>
          <button onClick={onClose} style={{ color: "#8A9186" }}><X size={16} /></button>
        </div>
        <div style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", borderRadius: 10, padding: 12, fontSize: 12.5, color: "#4A5247", lineHeight: 1.5, marginBottom: 14 }}>
          {message}
        </div>
        <div className="flex flex-col gap-2">
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2"
            style={{ background: "#4C8B5C", color: "#fff", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
          >
            <MessageCircle size={15} /> Open in WhatsApp
          </a>
          <button
            onClick={copy}
            className="flex items-center justify-center gap-2"
            style={{ background: "#F7F8F5", color: "#1F2A1D", border: "1px solid #E7E9E2", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 700 }}
          >
            <Copy size={14} /> {copied ? "Copied!" : "Copy message"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Reports ---------------------------------------------------------

function ReportsTab({ transactions, accounts }) {
  const months = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthly = months.map((mk) => {
    const tx = transactions.filter((t) => monthKeyOf(t.date) === mk);
    return {
      mk,
      income: round2(tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0)),
      expense: round2(tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0)),
    };
  });
  const maxVal = Math.max(1, ...monthly.map((m) => Math.max(m.income, m.expense)));

  const thisMonth = monthKeyOf(todayISO());
  const catTotals = EXPENSE_CATEGORIES.map((c) => ({
    ...c,
    total: round2(transactions.filter((t) => t.type === "expense" && t.category === c.name && monthKeyOf(t.date) === thisMonth).reduce((s, t) => s + t.amount, 0)),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const catMax = Math.max(1, ...catTotals.map((c) => c.total));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => exportTransactionsToCSV(transactions, accounts)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50"
        >
          <FileSpreadsheet size={14} className="text-emerald-600" />
          Export All Transactions (CSV)
        </button>
      </div>

      <Card>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D", marginBottom: 14 }}>Income vs. expense — last 6 months</div>
        <div className="flex flex-col gap-3">
          {monthly.map((m) => (
            <div key={m.mk}>
              <div className="flex items-center justify-between mb-1" style={{ fontSize: 11.5, color: "#8A9186" }}>
                <span>{monthLabel(m.mk)}</span>
                <span>+{money(m.income).slice(1)} / -{money(m.expense).slice(1)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <div style={{ background: "#EDEFEA", borderRadius: 5, height: 8 }}>
                  <div style={{ width: `${(m.income / maxVal) * 100}%`, background: "#4C8B5C", height: "100%", borderRadius: 5 }} />
                </div>
                <div style={{ background: "#EDEFEA", borderRadius: 5, height: 8 }}>
                  <div style={{ width: `${(m.expense / maxVal) * 100}%`, background: "#C05C4A", height: "100%", borderRadius: 5 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "#1F2A1D", marginBottom: 14 }}>This month's spending by category</div>
        {catTotals.length === 0 ? (
          <EmptyState icon={TrendingDown} text="No expenses logged this month yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {catTotals.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
                  <span className="flex items-center gap-1.5" style={{ color: "#1F2A1D" }}><c.icon size={12} color={c.color} /> {c.name}</span>
                  <span style={{ color: "#8A9186" }}>{money(c.total)}</span>
                </div>
                <ProgressBar pct={(c.total / catMax) * 100} color={c.color} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
