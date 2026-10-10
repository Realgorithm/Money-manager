import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus, Trash2, X, Wallet, ArrowUpRight, ArrowDownRight, ArrowRightLeft,
  MoreHorizontal, Pencil, Check, Download, Share, Landmark, Banknote, CreditCard, Repeat,
  HandCoins, TrendingUp, TrendingDown, Target, LayoutDashboard, List, User,
  Utensils, Car, Home, Zap, Music, Heart, ShoppingBag, Briefcase, Laptop, Gift, Percent,
  Lock, Copy, MessageCircle, Building2, CheckCheck, Search, ChevronDown, ChevronUp, FileSpreadsheet,
  Camera, Loader2, Sparkles, Leaf, Eye, EyeOff, Moon, Sun, Settings, KeyRound, ShieldCheck, Upload,
  Delete as DeleteIcon, PiggyBank, CalendarDays, Fingerprint, RefreshCw
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { parsePaymentReceipt, matchAccount } from "./receiptParser";

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

// ---- theme ("Sage Mist" light / "Forest Night" dark) ------------------------
// Soft, low-glare palettes: no pure white / pure black, muted greens, warm greys.
const PALETTES = {
  light: {
    bg: "#EDF1EA", card: "#F8FAF6", ink: "#26332A", text2: "#4F5C52", muted: "#68766C", faint: "#A3AFA5",
    line: "#D9E1D7", soft: "#E1E9DF", pos: "#4E8A63", neg: "#BF6455", warn: "#C79A3E",
    heroA: "#5A9477", heroB: "#3F7B6D", shadow: "0 2px 12px rgba(38,51,42,0.06)", scrim: "rgba(38,51,42,0.42)",
  },
  dark: {
    bg: "#111814", card: "#19221D", ink: "#DCE6DD", text2: "#B2C0B5", muted: "#8C9B90", faint: "#5E6C62",
    line: "#2A3730", soft: "#222D27", pos: "#58A06F", neg: "#D9776A", warn: "#D2A94F",
    heroA: "#2E5D49", heroB: "#244A47", shadow: "0 2px 14px rgba(0,0,0,0.30)", scrim: "rgba(0,0,0,0.55)",
  },
};
// T is read by every component while rendering; App swaps its values whenever the theme changes.
const T = { ...PALETTES.light };
let HIDE_AMOUNTS = false;
const applyTheme = (name, hide) => {
  Object.assign(T, PALETTES[name] || PALETTES.light);
  HIDE_AMOUNTS = !!hide;
};
const PREFS_KEY = "finance_prefs"; // per-device (not synced)
const DEFAULT_PREFS = { theme: "auto", hide: false, autoLockMin: 5 };
const loadPrefs = () => {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...DEFAULT_PREFS }; }
};

const uid = () => Math.random().toString(36).slice(2, 10);
const moneyRaw = (n) => (n < 0 ? "-₹" : "₹") + Math.abs(n).toFixed(2);
// money() honours the "hide amounts" privacy switch; moneyRaw() is for text that gets shared.
const money = (n) => (HIDE_AMOUNTS ? "₹ ••••" : moneyRaw(n));
const round2 = (n) => Math.round(n * 100) / 100;
const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
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

// Added 'wallet' account type for topups/wallets
const ACCOUNT_TYPES = [
  { id: "cash", label: "Cash", icon: Banknote, color: "#4C8B5C" },
  { id: "bank", label: "Bank", icon: Landmark, color: "#4A7FB5" },
  { id: "wallet", label: "Top-Up / Wallet", icon: Wallet, color: "#D97706" },
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
  { name: "Top-Up", color: "#D97706", icon: Wallet },
  { name: "Gift", color: "#8D6CB0", icon: Gift },
  { name: "Interest", color: "#4A7FB5", icon: Percent },
  { name: "Other", color: "#8A9186", icon: MoreHorizontal },
];
const expCatInfo = (name) => EXPENSE_CATEGORIES.find((c) => c.name === name) || EXPENSE_CATEGORIES.find((c) => c.name === "Other");
const incCatInfo = (name) => INCOME_CATEGORIES.find((c) => c.name === name) || INCOME_CATEGORIES.find((c) => c.name === "Other");
const catInfo = (name, type) => (type === "income" ? incCatInfo(name) : expCatInfo(name));

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly" };

function buildDebtMessage(d) {
  const amt = moneyRaw(d.amount);
  if (d.direction === "owed_to_me") {
    return `Hi ${d.person}, quick reminder — you owe me ${amt}${d.note ? ` for ${d.note}` : ""}. Thanks!`;
  }
  return `Hi ${d.person}, heads up — I owe you ${amt}${d.note ? ` for ${d.note}` : ""}. I'll get you sorted soon.`;
}

// One combined message listing every open debt with a member + the net balance.
function buildMemberSummaryMessage(person, items) {
  const theyOwe = items.filter((d) => d.direction === "owed_to_me");
  const iOwe = items.filter((d) => d.direction === "i_owe");
  const sum = (arr) => round2(arr.reduce((t, d) => t + d.amount, 0));
  const line = (d, i) => `${i + 1}. ${moneyRaw(d.amount)}${d.note ? ` – ${d.note}` : ""} (${fmtDateShort(d.date)})`;
  const net = round2(sum(theyOwe) - sum(iOwe));

  const parts = [`Hi ${person}, here's our current balance:`];
  if (theyOwe.length) parts.push("", `You owe me (${moneyRaw(sum(theyOwe))}):`, ...theyOwe.map(line));
  if (iOwe.length) parts.push("", `I owe you (${moneyRaw(sum(iOwe))}):`, ...iOwe.map(line));
  parts.push(
    "",
    net > 0 ? `Net: you owe me ${moneyRaw(net)}.` : net < 0 ? `Net: I owe you ${moneyRaw(Math.abs(net))}.` : "Net: we're all square.",
    net > 0 ? "Thanks!" : net < 0 ? "I'll get you sorted soon." : ""
  );
  return parts.join("\n").trim();
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
  const [pendingSharedFile, setPendingSharedFile] = useState(null);
  const [installEvent, setInstallEvent] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [iosInstallHint, setIosInstallHint] = useState(false);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [systemDark, setSystemDark] = useState(() => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const [showSettings, setShowSettings] = useState(false);
  const [bioOffer, setBioOffer] = useState(false);
  const [bioOfferErr, setBioOfferErr] = useState("");

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const n = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* best effort */ }
      return n;
    });
  }, []);
  const resolvedTheme = prefs.theme === "auto" ? (systemDark ? "dark" : "light") : prefs.theme;
  applyTheme(resolvedTheme, prefs.hide); // swap the palette BEFORE any child renders

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const h = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  useEffect(() => {
    document.body.style.background = T.bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", T.bg);
  }, [resolvedTheme]);

  // Offer fingerprint unlock once, after a successful PIN unlock, if this device can do it.
  useEffect(() => {
    if (!unlocked || bioCredId() || localStorage.getItem("finance_bio_dismissed") === "1") return;
    let live = true;
    bioUnavailableReason().then((r) => { if (live && !r) setBioOffer(true); });
    return () => { live = false; };
  }, [unlocked]);
  const enableBioFromOffer = async () => {
    try { await bioEnroll(credentials?.name); setBioOffer(false); }
    catch (e) { setBioOfferErr(e?.name === "NotAllowedError" ? "Setup was cancelled." : "Couldn't set it up on this device."); }
  };
  const dismissBioOffer = () => { localStorage.setItem("finance_bio_dismissed", "1"); setBioOffer(false); };

  const lockNow = useCallback(() => {
    sessionStorage.removeItem("finance_unlocked");
    setShowSettings(false);
    setQuickAddModal(false);
    setUnlocked(false);
  }, []);
  useEffect(() => {
    if (!unlocked || !prefs.autoLockMin) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ["pointerdown", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => { if (Date.now() - last > prefs.autoLockMin * 60000) lockNow(); }, 10000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, [unlocked, prefs.autoLockMin, lockNow]);

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
  // Pick up a screenshot shared in from another app (e.g. "Share" from
  // GPay/PhonePe → Money Manager). The service worker intercepts that
  // share, stashes the image in Cache Storage, then redirects here with
  // ?share=1 so we know to go fetch it and open the quick-add flow.
  useEffect(() => {
    if (!ready) return;
    if (new URLSearchParams(window.location.search).get("share") !== "1") return;
    (async () => {
      try {
        const cache = await caches.open("shared-images");
        const res = await cache.match("/shared-image");
        if (res) {
          const blob = await res.blob();
          const file = new File([blob], "shared-screenshot.jpg", { type: blob.type || "image/jpeg" });
          setPendingSharedFile(file);
          setQuickAddModal(true);
          await cache.delete("/shared-image");
        }
      } catch (err) {
        console.error("Could not read shared screenshot:", err);
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
  }, [ready]);

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
  const updateDebt = (id, updates) => {
    const next = { ...updates };
    if (next.person !== undefined) {
      next.person = next.person.trim();
      if (next.person && !debtMembers.includes(next.person)) persistDebtMembers([...debtMembers, next.person]);
    }
    if (next.amount !== undefined) next.amount = Math.abs(Number(next.amount) || 0);
    persistDebts(debts.map((d) => (d.id === id ? { ...d, ...next } : d)));
  };
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

  // Security & data (Settings)
  const changePin = async (current, next) => {
    if ((await hashPin(current)) !== credentials.pinHash) return "Current PIN is incorrect.";
    persistCredentials({ ...credentials, pinHash: await hashPin(next) });
    return "";
  };
  const saveName = (name) => persistCredentials({ ...credentials, name: name.trim().slice(0, 30) });
  const createRecovery = async () => {
    const code = genRecoveryCode();
    persistCredentials({ ...credentials, recoveryHash: await hashRecovery(code) });
    return code;
  };
  const eraseAll = async () => {
    for (const k of Object.values(KEYS)) {
      try { await window.storage.delete(k, true); } catch { /* best effort */ }
    }
    sessionStorage.removeItem("finance_unlocked");
    localStorage.removeItem("finance_pin_fails");
    window.location.reload();
  };
  const downloadFile = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportBackup = () =>
    downloadFile(
      `money-manager-backup_${todayISO()}.json`,
      JSON.stringify({ app: "money-manager", version: 1, exportedAt: new Date().toISOString(), data: { accounts, transactions, budgets, recurring, debts, debtMembers } }, null, 2),
      "application/json"
    );
  const restoreBackup = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      const d = parsed?.data;
      const lists = ["accounts", "transactions", "budgets", "recurring", "debts", "debtMembers"];
      if (parsed?.app !== "money-manager" || !d || !lists.every((k) => Array.isArray(d[k]))) {
        return { ok: false, text: "That doesn't look like a Money Manager backup." };
      }
      if (!window.confirm(`Replace your current data with this backup (${d.accounts.length} accounts, ${d.transactions.length} transactions)?`)) {
        return { ok: false, text: "Restore cancelled." };
      }
      persistAccounts(d.accounts); persistTransactions(d.transactions); persistBudgets(d.budgets);
      persistRecurring(d.recurring); persistDebts(d.debts);
      persistDebtMembers(d.debtMembers.length ? d.debtMembers : DEFAULT_DEBT_MEMBERS);
      return { ok: true, text: "Backup restored." };
    } catch {
      return { ok: false, text: "Couldn't read that file." };
    }
  };

  // Derived summaries
  const netWorth = round2(accounts.reduce((s, a) => s + a.balance, 0));
  const thisMonth = monthKeyOf(todayISO());
  const monthTx = transactions.filter((t) => monthKeyOf(t.date) === thisMonth);
  const monthIncome = round2(monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));
  const monthExpense = round2(monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const owedToMe = round2(debts.filter((d) => d.direction === "owed_to_me" && !d.settled).reduce((s, d) => s + d.amount, 0));
  const iOwe = round2(debts.filter((d) => d.direction === "i_owe" && !d.settled).reduce((s, d) => s + d.amount, 0));

  if (!ready) return <LoadingScreen />;
  if (!credentials) return <PinSetup onDone={(creds) => persistCredentials(creds)} />;
  if (!unlocked) {
    return (
      <PinUnlock
        credentials={credentials}
        onResetPin={(pinHash) => persistCredentials({ ...credentials, pinHash })}
        onErase={eraseAll}
        onUnlock={() => {
          sessionStorage.setItem("finance_unlocked", "1");
          setUnlocked(true);
        }}
      />
    );
  }

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.ink }}>
      <GlobalStyle />
      {(showInstallBanner || iosInstallHint) && (
        <InstallBanner
          onInstall={showInstallBanner ? handleInstallClick : null}
          onDismiss={dismissInstallBanner}
          ios={!showInstallBanner && iosInstallHint}
        />
      )}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-28 pt-6 sm:pt-8">
        <Header
          tab={tab}
          setTab={setTab}
          netWorth={netWorth}
          overdueBills={recurring.filter((r) => r.active && daysUntil(r.nextDue) < 0).length}
          prefs={prefs}
          setPrefs={setPrefs}
          resolvedTheme={resolvedTheme}
          onSettings={() => setShowSettings(true)}
          onLock={lockNow}
          name={credentials.name}
        />
        {bioOffer && <BioOffer onEnable={enableBioFromOffer} onDismiss={dismissBioOffer} error={bioOfferErr} />}
        <div key={tab} className="fade-up">

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
      </div>

      {/* Floating Action Button for Quick Add on any screen */}
      <button
        onClick={() => setQuickAddModal(true)}
        className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full text-white hover:scale-105 transition-all z-40"
        style={{ background: `linear-gradient(135deg, ${T.heroA}, ${T.heroB})`, boxShadow: "0 10px 28px rgba(0,0,0,0.22)" }}
      >
        <Plus size={18} />
        <span className="text-xs font-bold font-display">Log / Scan Receipt</span>
      </button>

      {showSettings && (
        <SettingsModal
          prefs={prefs}
          setPrefs={setPrefs}
          name={credentials?.name || ""}
          onSaveName={saveName}
          hasRecovery={!!credentials?.recoveryHash}
          onChangePin={changePin}
          onCreateRecovery={createRecovery}
          onBackup={exportBackup}
          onRestore={restoreBackup}
          onExportCsv={() => exportTransactionsToCSV(transactions, accounts)}
          onErase={eraseAll}
          onLock={lockNow}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Global Quick Add Modal with OCR Scanner */}
      {quickAddModal && (
        <QuickAddModal
          accounts={accounts}
          members={debtMembers}
          onClose={() => { setQuickAddModal(false); setPendingSharedFile(null); }}
          onAddTx={addTransaction}
          onAddDebt={addDebt}
          initialFile={pendingSharedFile}
        />
      )}
    </div>
  );
}

// ---- chrome & utility elements -------------------------------------------

function LoadingScreen() {
  return (
    <div style={{ background: T.bg, minHeight: "100vh" }} className="flex items-center justify-center">
      <GlobalStyle />
      <div style={{ color: T.muted, fontSize: 13 }}>Loading…</div>
    </div>
  );
}

function GlobalStyle() {
  const dark = T.bg === PALETTES.dark.bg;
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
      :root { color-scheme: ${dark ? "dark" : "light"}; }
      * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
      html, body { background: ${T.bg}; transition: background-color .25s ease; }
      body { color: ${T.ink}; -webkit-font-smoothing: antialiased; }
      .font-display { font-family: 'Manrope', sans-serif; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; }
      input, select, textarea { outline: none; }
      input:focus, select:focus { box-shadow: 0 0 0 3px ${T.pos}33; border-color: ${T.pos} !important; }
      input::placeholder { color: ${T.faint}; }
      button { cursor: pointer; transition: transform .12s ease, opacity .15s ease, background-color .2s ease, border-color .2s ease; }
      button:active:not(:disabled) { transform: scale(.97); }
      button:disabled { cursor: not-allowed; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
      .card-hover { transition: box-shadow .2s ease, transform .2s ease; }
      .card-hover:hover { box-shadow: 0 8px 24px ${dark ? "rgba(0,0,0,0.35)" : "rgba(38,51,42,0.09)"}; transform: translateY(-1px); }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
      @keyframes sheetIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
      .fade-up { animation: fadeUp .35s ease both; }
      .shake { animation: shake .35s ease; }
      .sheet-in { animation: sheetIn .28s ease both; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }

      /* Re-colour the few Tailwind utility classes used around the app so they follow the theme */
      .bg-white { background-color: ${T.card} !important; }
      .bg-slate-50, .hover\\:bg-slate-50:hover { background-color: ${T.bg} !important; }
      .bg-slate-100, .hover\\:bg-slate-100\\/70:hover, .hover\\:bg-slate-200:hover { background-color: ${T.soft} !important; }
      .bg-slate-900 { background-color: ${T.ink} !important; color: ${T.bg} !important; }
      .hover\\:bg-slate-800:hover { background-color: ${T.text2} !important; }
      .border-slate-200, .border-slate-100 { border-color: ${T.line} !important; }
      .border-slate-900 { border-color: ${T.ink} !important; }
      .text-slate-400 { color: ${T.faint} !important; }
      .text-slate-500, .text-slate-600, .hover\\:text-slate-600:hover { color: ${T.muted} !important; }
      .text-slate-700 { color: ${T.text2} !important; }
      .text-slate-800, .text-slate-900, .hover\\:text-slate-800:hover { color: ${T.ink} !important; }
      .bg-emerald-50, .bg-emerald-100\\/70, .hover\\:bg-emerald-100:hover { background-color: ${T.pos}22 !important; }
      .bg-rose-50, .hover\\:bg-rose-100:hover { background-color: ${T.neg}22 !important; }
      .text-emerald-600, .text-emerald-700, .text-emerald-800, .hover\\:text-emerald-800:hover { color: ${T.pos} !important; }
      .text-rose-700, .text-rose-800, .hover\\:text-rose-600:hover { color: ${T.neg} !important; }
      .bg-emerald-600 { background-color: ${T.pos} !important; }
      .bg-rose-600 { background-color: ${T.neg} !important; }
      .border-emerald-600 { border-color: ${T.pos} !important; }
    `}</style>
  );
}

// ---- auth ------------------------------------------------------------------

const RECOVERY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const genRecoveryCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = Array.from(bytes, (b) => RECOVERY_CHARS[b % RECOVERY_CHARS.length]).join("");
  return raw.match(/.{4}/g).join("-");
};
const formatRecovery = (v) => (v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16).match(/.{1,4}/g) || []).join("-");
const hashRecovery = (code) => hashPin("recovery:" + code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

function BrandMark({ size = 40 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.32, background: `linear-gradient(135deg, ${T.heroA}, ${T.heroB})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: T.shadow, flexShrink: 0 }}>
      <Leaf size={size * 0.5} color="#fff" />
    </div>
  );
}

function AuthShell({ children }) {
  return (
    <div style={{ background: `radial-gradient(900px 420px at 50% -8%, ${T.soft}, ${T.bg})`, minHeight: "100vh" }} className="flex items-center justify-center px-4 py-8">
      <GlobalStyle />
      <div className="fade-up" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 22, padding: 26, maxWidth: 380, width: "100%", boxShadow: T.shadow }}>
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({ children, style, ...rest }) {
  return (
    <button {...rest} className="w-full" style={{ background: T.pos, color: "#fff", borderRadius: 12, padding: "12px 16px", fontWeight: 700, fontSize: 13.5, opacity: rest.disabled ? 0.5 : 1, ...style }}>
      {children}
    </button>
  );
}
function LinkButton({ children, ...rest }) {
  return <button {...rest} style={{ color: T.muted, fontSize: 12.5, textDecoration: "underline", ...rest.style }}>{children}</button>;
}

function BioOffer({ onEnable, onDismiss, error }) {
  return (
    <div className="fade-up flex items-center gap-3" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 12, marginBottom: 16, boxShadow: T.shadow }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: T.pos + "22", color: T.pos, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Fingerprint size={20} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>Unlock with your fingerprint?</div>
        <div style={{ fontSize: 11.5, color: error ? T.neg : T.muted }}>{error || "Skip typing your PIN on this device. The PIN still works."}</div>
      </div>
      <button onClick={onEnable} style={{ background: T.pos, color: "#fff", borderRadius: 10, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}>Turn on</button>
      <button onClick={onDismiss} aria-label="Dismiss" style={{ color: T.muted }}><X size={16} /></button>
    </div>
  );
}

function PinPad({ value, onChange, onSubmit, max = 8, disabled, shake }) {
  const latest = useRef({});
  latest.current = { value, onChange, onSubmit, disabled };
  useEffect(() => {
    const h = (e) => {
      const { value, onChange, onSubmit, disabled } = latest.current;
      if (disabled || e.target.tagName === "INPUT") return;
      if (/^\d$/.test(e.key)) { if (value.length < max) onChange(value + e.key); }
      else if (e.key === "Backspace") onChange(value.slice(0, -1));
      else if (e.key === "Enter" && onSubmit) onSubmit();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [max]);

  const key = (content, onClick, label) => (
    <button key={label} aria-label={label} disabled={disabled} onClick={onClick}
      style={{ height: 54, borderRadius: 14, background: T.soft, color: T.ink, fontSize: 19, fontWeight: 600, border: `1px solid ${T.line}`, opacity: disabled ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {content}
    </button>
  );
  return (
    <div>
      <div className={shake ? "shake" : ""} style={{ display: "flex", justifyContent: "center", gap: 12, margin: "4px 0 18px", minHeight: 14 }}>
        {Array.from({ length: Math.max(4, value.length) }).map((_, i) => (
          <span key={i} style={{ width: 13, height: 13, borderRadius: 99, background: i < value.length ? T.pos : "transparent", border: `2px solid ${i < value.length ? T.pos : T.faint}`, transition: "all .15s" }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => key(d, () => value.length < max && onChange(value + d), d))}
        <div />
        {key("0", () => value.length < max && onChange(value + "0"), "0")}
        {key(<DeleteIcon size={19} />, () => onChange(value.slice(0, -1)), "Delete")}
      </div>
    </div>
  );
}

// Enter a new PIN, then confirm it.
function NewPinFlow({ title, subtitle, onDone, onBack }) {
  const [step, setStep] = useState("enter");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const bad = (msg) => { setError(msg); setShake(true); setTimeout(() => setShake(false), 400); setValue(""); };
  const next = async () => {
    if (value.length < 4) return bad("Use at least 4 digits.");
    if (step === "enter") { setFirst(value); setValue(""); setError(""); setStep("confirm"); return; }
    if (value !== first) { setStep("enter"); setFirst(""); return bad("PINs didn't match — start again."); }
    setBusy(true);
    await onDone(value);
    setBusy(false);
  };
  return (
    <>
      <div className="flex items-center gap-3 mb-4"><BrandMark /><div>
        <h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>{title}</h1>
        <div style={{ color: T.muted, fontSize: 12.5 }}>{step === "enter" ? subtitle : "Enter it once more to confirm"}</div>
      </div></div>
      <PinPad value={value} onChange={(v) => { setValue(v); setError(""); }} onSubmit={next} shake={shake} disabled={busy} />
      <div style={{ minHeight: 22, color: T.neg, fontSize: 12.5, textAlign: "center", margin: "12px 0 6px" }}>{error}</div>
      <PrimaryButton onClick={next} disabled={busy || value.length < 4}>{step === "enter" ? "Continue" : "Confirm PIN"}</PrimaryButton>
      {onBack && <div className="text-center mt-3"><LinkButton onClick={onBack}>Back</LinkButton></div>}
    </>
  );
}

function PinSetup({ onDone }) {
  const [name, setName] = useState("");
  const [nameDone, setNameDone] = useState(false);
  const [pinHash, setPinHash] = useState(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* best effort */ }
  };

  if (!nameDone) {
    return (
      <AuthShell>
        <div className="flex items-center gap-3 mb-4"><BrandMark /><div>
          <h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>Welcome 👋</h1>
          <div style={{ color: T.muted, fontSize: 12.5 }}>What should we call you?</div>
        </div></div>
        <FieldInput autoFocus placeholder="Your name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setNameDone(true)} style={{ width: "100%", padding: "12px 12px", fontSize: 15, marginBottom: 14 }} />
        <PrimaryButton onClick={() => setNameDone(true)}>{name.trim() ? "Continue" : "Skip"}</PrimaryButton>
      </AuthShell>
    );
  }
  if (!pinHash) {
    return (
      <AuthShell>
        <NewPinFlow
          title="Create your PIN"
          subtitle="Keeps your records private"
          onDone={async (pin) => { setPinHash(await hashPin(pin)); setCode(genRecoveryCode()); }}
        />
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <div className="flex items-center gap-3 mb-3"><BrandMark /><h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>Save your recovery code</h1></div>
      <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
        If you forget your PIN, this code is the only way back in without erasing your data. Keep it somewhere safe — it won't be shown again.
      </div>
      <div className="mono" style={{ background: T.soft, border: `1px dashed ${T.faint}`, borderRadius: 12, padding: "14px 10px", textAlign: "center", fontSize: 17, fontWeight: 700, letterSpacing: 1.5, color: T.ink, userSelect: "all" }}>{code}</div>
      <button onClick={copy} className="flex items-center justify-center gap-2 w-full" style={{ marginTop: 10, background: T.soft, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
        <Copy size={14} /> {copied ? "Copied!" : "Copy code"}
      </button>
      <label className="flex items-center gap-2" style={{ margin: "14px 0", fontSize: 12.5, color: T.text2, cursor: "pointer" }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery code
      </label>
      <PrimaryButton disabled={!saved} onClick={async () => onDone({ pinHash, recoveryHash: await hashRecovery(code), name: name.trim() })}>Start using Money Manager</PrimaryButton>
      <div className="text-center mt-3"><LinkButton onClick={() => onDone({ pinHash, name: name.trim() })}>Skip for now (you can create one in Settings)</LinkButton></div>
    </AuthShell>
  );
}

// ---- fingerprint / face / screen-lock unlock (WebAuthn platform authenticator) ----
// Per-device convenience: the phone's own biometric prompt replaces typing the PIN.
// The PIN stays the real secret and always works as a fallback.
const BIO_KEY = "finance_bio";
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};
const bioCredId = () => { try { return JSON.parse(localStorage.getItem(BIO_KEY))?.id || null; } catch { return null; } };
const APP_BUILD = "2026.10.10-bio2"; // shown in Settings so you can tell which version is running
// Returns "" when fingerprint unlock can be tried, otherwise a human-readable reason.
const bioUnavailableReason = async () => {
  if (!window.isSecureContext) return "Needs a secure (https) connection.";
  if (!window.PublicKeyCredential || !navigator.credentials?.create) return "This browser doesn't support fingerprint sign-in.";
  try {
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) {
      return "No fingerprint or screen lock found — set one up in your phone's security settings.";
    }
  } catch { /* some browsers throw; let the real attempt decide */ }
  return "";
};
const bioEnroll = async (label) => {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Money Manager" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "owner", displayName: label || "Owner" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("cancelled");
  localStorage.setItem(BIO_KEY, JSON.stringify({ id: b64u.enc(cred.rawId) }));
};
const bioVerify = async () => {
  const id = bioCredId();
  if (!id) return false;
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: b64u.dec(id), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!res;
  } catch { return false; }
};

const FAIL_KEY = "finance_pin_fails"; // per-device wrong-PIN counter
const readFails = () => { try { return JSON.parse(localStorage.getItem(FAIL_KEY)) || { count: 0, until: 0 }; } catch { return { count: 0, until: 0 }; } };

function PinUnlock({ credentials, onUnlock, onResetPin, onErase }) {
  const [view, setView] = useState("pin"); // pin | recover | newpin | erase
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [fails, setFails] = useState(readFails);
  const [now, setNow] = useState(Date.now());
  const [codeInput, setCodeInput] = useState("");
  const [eraseText, setEraseText] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = fails.until > now;
  const secsLeft = Math.max(0, Math.ceil((fails.until - now) / 1000));

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  // Fingerprint unlock: prompt automatically once, and keep a button for retries.
  const [bio] = useState(() => !!bioCredId());
  const [bioBusy, setBioBusy] = useState(false);
  const bioAuto = useRef(false);
  const tryBio = useCallback(async () => {
    setBioBusy(true);
    const ok = await bioVerify();
    setBioBusy(false);
    if (ok) { localStorage.removeItem(FAIL_KEY); onUnlock(); } else setError("Fingerprint didn't work — use your PIN.");
  }, [onUnlock]);
  useEffect(() => {
    if (bio && !bioAuto.current) { bioAuto.current = true; tryBio(); }
  }, [bio, tryBio]);

  const submit = async () => {
    if (locked || pin.length < 4) return;
    if ((await hashPin(pin)) === credentials.pinHash) { localStorage.removeItem(FAIL_KEY); onUnlock(); return; }
    const count = fails.count + 1;
    const until = count % 5 === 0 ? Date.now() + Math.min(30 * 2 ** (count / 5 - 1), 900) * 1000 : 0;
    const next = { count, until };
    localStorage.setItem(FAIL_KEY, JSON.stringify(next));
    setFails(next);
    setNow(Date.now());
    setPin("");
    setShake(true);
    setTimeout(() => setShake(false), 400);
    const left = 5 - (count % 5);
    setError(until ? "Too many wrong attempts." : left <= 2 ? `Incorrect PIN · ${left} ${left === 1 ? "try" : "tries"} left before a short lock` : "Incorrect PIN.");
  };

  const verifyCode = async () => {
    setBusy(true);
    const ok = credentials.recoveryHash && (await hashRecovery(codeInput)) === credentials.recoveryHash;
    setBusy(false);
    if (ok) { setError(""); setView("newpin"); } else setError("That recovery code doesn't match.");
  };

  const go = (v) => { setView(v); setError(""); setPin(""); };

  if (view === "newpin") {
    return (
      <AuthShell>
        <NewPinFlow
          title="Choose a new PIN"
          subtitle="Recovery code accepted"
          onBack={() => go("pin")}
          onDone={async (p) => { localStorage.removeItem(FAIL_KEY); onResetPin(await hashPin(p)); onUnlock(); }}
        />
      </AuthShell>
    );
  }

  if (view === "recover") {
    return (
      <AuthShell>
        <div className="flex items-center gap-3 mb-3"><BrandMark /><h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>Forgot your PIN?</h1></div>
        {credentials.recoveryHash ? (
          <>
            <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>Enter the recovery code you saved when you set up your PIN.</div>
            <FieldInput autoFocus className="mono" placeholder="XXXX-XXXX-XXXX-XXXX" value={codeInput} onChange={(e) => { setCodeInput(formatRecovery(e.target.value)); setError(""); }} onKeyDown={(e) => e.key === "Enter" && verifyCode()} style={{ width: "100%", textAlign: "center", letterSpacing: 1.5, fontSize: 15, padding: "12px 10px" }} />
            <div style={{ minHeight: 22, color: T.neg, fontSize: 12.5, margin: "8px 0" }}>{error}</div>
            <PrimaryButton disabled={busy || codeInput.length < 19} onClick={verifyCode}>Verify code</PrimaryButton>
          </>
        ) : (
          <div style={{ background: T.soft, borderRadius: 12, padding: 12, color: T.text2, fontSize: 12.5, lineHeight: 1.5 }}>
            No recovery code was created for this PIN, so it can't be reset. Your only option is to erase everything and start fresh.
          </div>
        )}
        <div className="flex justify-between mt-4">
          <LinkButton onClick={() => go("pin")}>Back</LinkButton>
          <LinkButton onClick={() => go("erase")} style={{ color: T.neg }}>Erase data &amp; start over</LinkButton>
        </div>
      </AuthShell>
    );
  }

  if (view === "erase") {
    return (
      <AuthShell>
        <div className="flex items-center gap-3 mb-3"><BrandMark /><h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>Erase everything?</h1></div>
        <div style={{ color: T.text2, fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
          This permanently deletes all accounts, transactions, budgets, bills and debts for everyone using this app, then lets you set a new PIN. It can't be undone.
        </div>
        <FieldInput placeholder="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
        <PrimaryButton disabled={eraseText !== "ERASE" || busy} style={{ background: T.neg }} onClick={async () => { setBusy(true); await onErase(); }}>
          {busy ? "Erasing…" : "Erase all data"}
        </PrimaryButton>
        <div className="text-center mt-3"><LinkButton onClick={() => go("pin")}>Cancel</LinkButton></div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex items-center gap-3 mb-4"><BrandMark /><div>
        <h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>{credentials.name ? `Welcome back, ${credentials.name}` : "Welcome back"}</h1>
        <div style={{ color: T.muted, fontSize: 12.5 }}>Enter your PIN to unlock</div>
      </div></div>
      <PinPad value={pin} onChange={(v) => { setPin(v); setError(""); }} onSubmit={submit} shake={shake} disabled={locked} />
      <div style={{ minHeight: 22, color: T.neg, fontSize: 12.5, textAlign: "center", margin: "12px 0 6px" }}>
        {locked ? `Locked for ${secsLeft}s — try again soon.` : error}
      </div>
      <PrimaryButton disabled={locked || pin.length < 4} onClick={submit}>Unlock</PrimaryButton>
      {bio && (
        <button onClick={tryBio} disabled={bioBusy} className="flex items-center justify-center gap-2 w-full" style={{ marginTop: 10, background: T.soft, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 12, padding: "11px 16px", fontSize: 13.5, fontWeight: 600, opacity: bioBusy ? 0.6 : 1 }}>
          <Fingerprint size={17} /> {bioBusy ? "Waiting for fingerprint…" : "Use fingerprint"}
        </button>
      )}
      <div className="text-center mt-3"><LinkButton onClick={() => go("recover")}>Forgot PIN?</LinkButton></div>
    </AuthShell>
  );
}

// ---- Settings ---------------------------------------------------------------

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: T.soft, borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{ flex: 1, padding: "6px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: value === o.id ? T.card : "transparent", color: value === o.id ? T.ink : T.muted, boxShadow: value === o.id ? T.shadow : "none" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ width: 42, height: 24, borderRadius: 99, background: on ? T.pos : T.faint, position: "relative", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left .18s ease" }} />
    </button>
  );
}

function SettingsSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
function SettingsRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 1 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
function SoftButton({ children, danger, ...rest }) {
  return (
    <button {...rest} className="flex items-center justify-center gap-2" style={{ background: T.soft, color: danger ? T.neg : T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600, ...rest.style }}>
      {children}
    </button>
  );
}

function SettingsModal({ prefs, setPrefs, name, onSaveName, hasRecovery, onChangePin, onCreateRecovery, onBackup, onRestore, onExportCsv, onErase, onLock, onClose }) {
  const [nameDraft, setNameDraft] = useState(name || "");
  const [nameSaved, setNameSaved] = useState(false);
  const [pinForm, setPinForm] = useState({ cur: "", next: "", confirm: "" });
  const [pinMsg, setPinMsg] = useState(null);
  const [bioOn, setBioOn] = useState(() => !!bioCredId());
  const [bioReason, setBioReason] = useState(null); // null = still checking, "" = OK
  const [bioMsg, setBioMsg] = useState("");
  useEffect(() => { bioUnavailableReason().then(setBioReason); }, []);
  const toggleBio = async (on) => {
    setBioMsg("");
    if (!on) { localStorage.removeItem(BIO_KEY); setBioOn(false); return; }
    try {
      await bioEnroll(name);
      setBioOn(true);
      setBioMsg("Fingerprint unlock is on for this device.");
    } catch (e) {
      setBioMsg(e?.name === "NotAllowedError" ? "Setup was cancelled." : "Couldn't set up fingerprint on this device.");
    }
  };
  const [newCode, setNewCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const fileRef = useRef(null);
  const digits = (v) => v.replace(/\D/g, "").slice(0, 8);

  const savePin = async () => {
    if (pinForm.next.length < 4) return setPinMsg({ ok: false, text: "New PIN needs at least 4 digits." });
    if (pinForm.next !== pinForm.confirm) return setPinMsg({ ok: false, text: "New PINs don't match." });
    const err = await onChangePin(pinForm.cur, pinForm.next);
    if (err) return setPinMsg({ ok: false, text: err });
    setPinForm({ cur: "", next: "", confirm: "" });
    setPinMsg({ ok: true, text: "PIN updated." });
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(newCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* best effort */ }
  };
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setRestoreMsg(await onRestore(file));
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 1200, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0 }} className="sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="sheet-in" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: "22px 22px 0 0", padding: 20, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: T.shadow }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display" style={{ fontWeight: 800, fontSize: 18, color: T.ink }}>Settings</div>
          <button onClick={onClose} aria-label="Close" style={{ color: T.muted }}><X size={18} /></button>
        </div>

        <SettingsSection title="Profile">
          <div className="flex gap-2">
            <FieldInput placeholder="Your name" value={nameDraft} maxLength={30} onChange={(e) => { setNameDraft(e.target.value); setNameSaved(false); }} onKeyDown={(e) => e.key === "Enter" && (onSaveName(nameDraft), setNameSaved(true))} style={{ flex: 1, minWidth: 0 }} />
            <SoftButton onClick={() => { onSaveName(nameDraft); setNameSaved(true); }} disabled={nameDraft.trim() === (name || "")}>{nameSaved ? "Saved" : "Save"}</SoftButton>
          </div>
        </SettingsSection>

        <SettingsSection title="Appearance & privacy">
          <Segmented value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[{ id: "auto", label: "Auto" }, { id: "light", label: "Sage light" }, { id: "dark", label: "Forest night" }]} />
          <SettingsRow label="Hide amounts" hint="Masks every balance on screen"><Switch on={prefs.hide} onChange={(hide) => setPrefs({ hide })} /></SettingsRow>
          <SettingsRow label="Auto-lock" hint="Lock after you've been idle">
            <FieldSelect value={prefs.autoLockMin} onChange={(e) => setPrefs({ autoLockMin: Number(e.target.value) })} style={{ width: 110 }}>
              <option value={0}>Never</option><option value={1}>1 min</option><option value={5}>5 min</option><option value={15}>15 min</option><option value={30}>30 min</option>
            </FieldSelect>
          </SettingsRow>
          <SoftButton onClick={onLock}><Lock size={14} /> Lock now</SoftButton>
        </SettingsSection>

        <SettingsSection title="Security">
          <SettingsRow label="Fingerprint unlock" hint={bioReason ? bioReason : "Unlock with your phone's fingerprint or screen lock · this device only · PIN still works"}>
            <Switch on={bioOn} onChange={bioReason ? () => setBioMsg(bioReason) : toggleBio} />
          </SettingsRow>
          {bioMsg && <div style={{ fontSize: 12.5, color: bioOn ? T.pos : T.neg }}>{bioMsg}</div>}
          <div className="flex flex-col gap-2">
            <FieldInput type="password" inputMode="numeric" placeholder="Current PIN" value={pinForm.cur} onChange={(e) => setPinForm({ ...pinForm, cur: digits(e.target.value) })} />
            <div className="grid grid-cols-2 gap-2">
              <FieldInput type="password" inputMode="numeric" placeholder="New PIN" value={pinForm.next} onChange={(e) => setPinForm({ ...pinForm, next: digits(e.target.value) })} />
              <FieldInput type="password" inputMode="numeric" placeholder="Confirm" value={pinForm.confirm} onChange={(e) => setPinForm({ ...pinForm, confirm: digits(e.target.value) })} />
            </div>
            {pinMsg && <div style={{ fontSize: 12.5, color: pinMsg.ok ? T.pos : T.neg }}>{pinMsg.text}</div>}
            <SoftButton onClick={savePin} disabled={!pinForm.cur || !pinForm.next}><KeyRound size={14} /> Change PIN</SoftButton>
          </div>
          <SettingsRow label="Recovery code" hint={hasRecovery ? "Set — lets you reset a forgotten PIN" : "Not set — a forgotten PIN can't be reset"}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: hasRecovery ? T.pos : T.warn }}>{hasRecovery ? "Active" : "Missing"}</span>
          </SettingsRow>
          {newCode ? (
            <div style={{ background: T.soft, borderRadius: 12, padding: 12 }}>
              <div className="mono" style={{ textAlign: "center", fontSize: 16, fontWeight: 700, letterSpacing: 1.5, color: T.ink, userSelect: "all" }}>{newCode}</div>
              <div style={{ fontSize: 11.5, color: T.muted, margin: "8px 0", lineHeight: 1.45 }}>Save this now — it won't be shown again, and any older code no longer works.</div>
              <SoftButton onClick={copyCode} style={{ width: "100%" }}><Copy size={14} /> {copied ? "Copied!" : "Copy code"}</SoftButton>
            </div>
          ) : (
            <SoftButton onClick={async () => setNewCode(await onCreateRecovery())}><ShieldCheck size={14} /> {hasRecovery ? "Generate a new recovery code" : "Create recovery code"}</SoftButton>
          )}
        </SettingsSection>

        <SettingsSection title="Your data">
          <div className="grid grid-cols-2 gap-2">
            <SoftButton onClick={onBackup}><Download size={14} /> Backup</SoftButton>
            <SoftButton onClick={() => fileRef.current?.click()}><Upload size={14} /> Restore</SoftButton>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} style={{ display: "none" }} />
          {restoreMsg && <div style={{ fontSize: 12.5, color: restoreMsg.ok ? T.pos : T.neg }}>{restoreMsg.text}</div>}
          <SoftButton onClick={onExportCsv}><FileSpreadsheet size={14} /> Export transactions (CSV)</SoftButton>
          <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>Backups are plain JSON files — keep them somewhere private. Restoring replaces your current data (your PIN is kept).</div>
        </SettingsSection>

        <SettingsSection title="App">
          <SoftButton onClick={async () => {
            try { (await navigator.serviceWorker?.getRegistrations?.())?.forEach((r) => r.update()); } catch { /* best effort */ }
            window.location.reload();
          }}><RefreshCw size={14} /> Check for update &amp; reload</SoftButton>
          <div style={{ fontSize: 11.5, color: T.muted }}>Version {APP_BUILD}</div>
        </SettingsSection>

        <SettingsSection title="Danger zone">
          {!eraseOpen ? (
            <SoftButton danger onClick={() => setEraseOpen(true)}><Trash2 size={14} /> Erase all data…</SoftButton>
          ) : (
            <div className="flex flex-col gap-2">
              <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>This deletes everything, including your PIN. Download a backup first.</div>
              <FieldInput placeholder="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} />
              <SoftButton danger disabled={eraseText !== "ERASE"} onClick={onErase}>Erase everything</SoftButton>
            </div>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}

function InstallBanner({ onInstall, onDismiss, ios }) {
  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 999,
        maxWidth: 420, margin: "0 auto",
        background: T.ink, color: T.bg, borderRadius: 14,
        padding: "12px 14px", boxShadow: "0 10px 30px rgba(31,42,29,0.35)",
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 8, background: T.pos, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {ios ? <Share size={15} color={T.bg} /> : <Download size={15} color={T.bg} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35 }}>
        {ios ? (
          <>Install this app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</>
        ) : (
          <>Install Money Manager for quick access and offline use.</>
        )}
      </div>
      {onInstall && (
        <button onClick={onInstall} style={{ background: T.pos, color: T.bg, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "7px 12px", flexShrink: 0 }}>
          Install
        </button>
      )}
      <button onClick={onDismiss} style={{ color: T.faint, flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}

function IconButton({ children, label, onClick, active }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: active ? T.soft : T.card, color: active ? T.pos : T.text2, border: `1px solid ${T.line}`, boxShadow: T.shadow }}>
      {children}
    </button>
  );
}

function Header({ tab, setTab, netWorth, overdueBills, prefs, setPrefs, resolvedTheme, onSettings, onLock, name }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "transactions", label: "Transactions", icon: List },
    { id: "debts", label: "Debts", icon: HandCoins },
    { id: "accounts", label: "Accounts", icon: Wallet },
    { id: "budgets", label: "Budgets", icon: Target },
    { id: "bills", label: "Bills", icon: Repeat, badge: overdueBills },
    { id: "reports", label: "Reports", icon: TrendingUp },
  ];
  const hr = new Date().getHours();
  const greeting = hr < 5 ? "Still up?" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <BrandMark size={42} />
          <div style={{ minWidth: 0 }}>
            <h1 className="font-display" style={{ color: T.ink, fontSize: 21, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.15 }}>Money Manager</h1>
            <div style={{ color: T.muted, fontSize: 12.5 }}>
              {greeting}
              {name ? <>, <strong style={{ color: T.ink, fontWeight: 700 }}>{name}</strong></> : <> · <button onClick={onSettings} style={{ color: T.pos, textDecoration: "underline" }}>add your name</button></>}
              {" · "}<span style={{ color: netWorth < 0 ? T.neg : T.text2, fontWeight: 600 }}>{money(netWorth)}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <IconButton label={prefs.hide ? "Show amounts" : "Hide amounts"} active={prefs.hide} onClick={() => setPrefs({ hide: !prefs.hide })}>
            {prefs.hide ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          <IconButton label={resolvedTheme === "dark" ? "Switch to light" : "Switch to dark"} onClick={() => setPrefs({ theme: resolvedTheme === "dark" ? "light" : "dark" })}>
            {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton label="Settings" onClick={onSettings}><Settings size={16} /></IconButton>
          <IconButton label="Lock" onClick={onLock}><Lock size={16} /></IconButton>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3.5 py-2 flex-shrink-0"
              style={{
                background: active ? T.pos : T.card,
                color: active ? "#fff" : T.text2,
                border: `1px solid ${active ? T.pos : T.line}`,
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: active ? "none" : T.shadow,
              }}
            >
              <Icon size={14} />
              {label}
              {badge > 0 && (
                <span style={{ background: active ? "#fff" : T.neg, color: active ? T.pos : "#fff", fontSize: 10, borderRadius: 8, padding: "1px 5px", fontWeight: 700 }}>
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
      <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div className="font-display" style={{ color: color || T.ink, fontSize: 19, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2" style={{ color: T.faint, gridColumn: "1 / -1" }}>
      <Icon size={24} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function FieldInput(props) {
  return <input {...props} style={{ background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }} />;
}
function FieldSelect(props) {
  return <select {...props} style={{ background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }} />;
}
function Card({ children, style, className }) {
  return (
    <div className={className} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, boxShadow: T.shadow, ...style }}>
      {children}
    </div>
  );
}
function ProgressBar({ pct, color }) {
  return (
    <div style={{ background: T.soft, borderRadius: 6, height: 7, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: "100%", borderRadius: 6 }} />
    </div>
  );
}

// ---- Receipt OCR Uploader Component ---------------------------------------

function ReceiptUploader({ accounts, onParsedData, initialFile }) {
  const [loading, setLoading] = useState(false);

  const processFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await parsePaymentReceipt(file);
      onParsedData(data);
    } catch (err) {
      console.error("OCR parse failed:", err);
      alert("Could not automatically parse screenshot. Please type details manually.");
    } finally {
      setLoading(false);
    }
  };

  // When a screenshot arrives via the OS share sheet (Android "Share to
  // Money Manager"), it's handed to us as a ready-made File — run it
  // through OCR immediately instead of waiting for a manual upload/paste.
  useEffect(() => {
    if (initialFile) processFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        processFile(file);
        break;
      }
    }
  };

  return (
    <div
      onPaste={handlePaste}
      tabIndex={0}
      className="border-2 border-dashed border-slate-200 rounded-xl p-3 text-center bg-slate-50 hover:bg-slate-100/70 transition-all focus:outline-none focus:border-emerald-600"
    >
      <input
        type="file"
        accept="image/*"
        id="ss-input"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) processFile(e.target.files[0]);
        }}
      />
      <label htmlFor="ss-input" className="cursor-pointer flex flex-col items-center gap-1">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-emerald-700 font-semibold text-xs">
            <Loader2 className="animate-spin" size={16} />
            <span>Scanning receipt with OCR…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-100/70 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
              <Sparkles size={12} />
              <span>Smart Screenshot OCR</span>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              Click to upload or <strong>Paste (Ctrl+V)</strong> payment screenshot
            </p>
            <span className="text-[10.5px] text-slate-400">Auto-detects Amount, Mode & Matching Wallet</span>
          </>
        )}
      </label>
    </div>
  );
}

// ---- Global Quick Add Modal ----------------------------------------------

function QuickAddModal({ accounts, members, onClose, onAddTx, onAddDebt, initialFile }) {
  const [mode, setMode] = useState("tx"); // 'tx' or 'debt'
  const [txType, setTxType] = useState("expense");
  const [debtDir, setDebtDir] = useState("owed_to_me");
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState(members[0] || "");
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [category, setCategory] = useState("Food");
  const [note, setNote] = useState("");

  const handleParsedData = (data) => {
    if (data.amount) setAmount(data.amount);
    if (data.type) setTxType(data.type);
    if (data.note) setNote(data.note);

    // Category: the parser's guess is already specific to income vs expense.
    // For an income receipt always set a valid income category (the old code
    // left the stale expense one, e.g. "Food", while the dropdown displayed
    // "Salary"), and only override an expense category on a confident match.
    if (data.type === "income") {
      setCategory(data.category || "Other");
    } else if (data.category) {
      setCategory(data.category);
    }

    // Auto-match the account from the screenshot (masked a/c digits, bank
    // name like "Bank of Baroda" → "BOB", account name, or a real wallet).
    const acc = matchAccount(accounts, data.rawText);
    if (acc) setAccountId(acc.id);
  };

  // Keep the category valid for the selected type (switching Expense ↔ Income
  // by hand used to leave an invalid category in state).
  useEffect(() => {
    const list = txType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!list.some((c) => c.name === category)) setCategory(list[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txType]);

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
        className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-display font-bold text-base text-slate-900">Quick Log</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Screenshot Uploader Component */}
        <div className="mb-3">
          <ReceiptUploader accounts={accounts} onParsedData={handleParsedData} initialFile={initialFile} />
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
                Income / Top-Up
              </button>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1">Account / Top-Up Wallet</label>
              <FieldSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: "100%" }}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </FieldSelect>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1">Category</label>
              <FieldSelect value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%" }}>
                {(txType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </FieldSelect>
            </div>
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
            placeholder="Note / Merchant"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <button
          onClick={submit}
          className="w-full mt-4 bg-slate-900 text-white py-2.5 rounded-lg text-xs font-bold font-display hover:bg-slate-800"
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

  // Insight tiles
  const nowD = new Date();
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const prevD = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
  const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
  const prevExpense = round2(transactions.filter((t) => t.type === "expense" && monthKeyOf(t.date) === prevKey).reduce((s, t) => s + t.amount, 0));
  const spendDelta = prevExpense > 0 ? Math.round(((monthExpense - prevExpense) / prevExpense) * 100) : null;
  const savingsRate = monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100) : null;
  const projected = round2((monthExpense / Math.max(1, nowD.getDate())) * daysInMonth);
  const catTotals = {};
  transactions
    .filter((t) => t.type === "expense" && monthKeyOf(t.date) === monthKeyOf(todayISO()))
    .forEach((t) => { catTotals[t.category || "Other"] = (catTotals[t.category || "Other"] || 0) + t.amount; });
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const insights = [
    { label: "Saved", icon: PiggyBank, value: savingsRate === null ? "—" : `${savingsRate}%`, hint: savingsRate === null ? "No income yet" : "of income kept", tone: savingsRate === null ? null : savingsRate < 0 ? T.neg : T.pos },
    { label: "vs last month", icon: spendDelta !== null && spendDelta > 0 ? TrendingUp : TrendingDown, value: spendDelta === null ? "—" : `${spendDelta > 0 ? "+" : ""}${spendDelta}%`, hint: spendDelta === null ? "No data last month" : "spending", tone: spendDelta === null ? null : spendDelta > 0 ? T.neg : T.pos },
    { label: "Top category", icon: Sparkles, value: topCat ? topCat[0] : "—", hint: topCat ? money(round2(topCat[1])) : "No spending yet" },
    { label: "Month pace", icon: CalendarDays, value: monthExpense > 0 ? money(projected) : "—", hint: "projected spend" },
  ];

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
      <div className="fade-up" style={{ background: `linear-gradient(135deg, ${T.heroA}, ${T.heroB})`, borderRadius: 20, padding: 20, color: "#fff", boxShadow: T.shadow }}>
        <div style={{ fontSize: 11.5, opacity: 0.8, letterSpacing: 0.8, textTransform: "uppercase" }}>Net worth</div>
        <div className="font-display" style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, margin: "2px 0 14px" }}>{money(netWorth)}</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Income", value: money(monthIncome), icon: ArrowDownRight },
            { label: "Spent", value: money(monthExpense), icon: ArrowUpRight },
            { label: "Net", value: money(netThisMonth), icon: TrendingUp },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.14)", borderRadius: 12, padding: "9px 10px", minWidth: 0 }}>
              <div className="flex items-center gap-1" style={{ fontSize: 10.5, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.5 }}><Icon size={11} /> {label}</div>
              <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 10 }}>This month so far</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {insights.map(({ label, value, hint, icon: Icon, tone }) => (
          <div key={label} className="card-hover fade-up" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 12, boxShadow: T.shadow, minWidth: 0 }}>
            <div className="flex items-center gap-1.5" style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}><Icon size={12} /> {label}</div>
            <div className="font-display" style={{ color: tone || T.ink, fontSize: 17, fontWeight: 800, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            <div style={{ color: T.muted, fontSize: 11.5, marginTop: 1 }}>{hint}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>Debts Summary</div>
            <button onClick={() => setTab("debts")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>manage debts</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Owed to you" value={money(owedToMe)} color={T.pos} />
            <StatCard label="You owe" value={money(iOwe)} color={T.neg} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>Upcoming bills</div>
            <button onClick={() => setTab("bills")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>view all</button>
          </div>
          {upcoming.length === 0 ? (
            <div style={{ color: T.faint, fontSize: 12.5 }}>No recurring bills due soon.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((r) => {
                const d = daysUntil(r.nextDue);
                const overdue = d < 0;
                return (
                  <div key={r.id} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                    <span style={{ color: T.ink }}>{r.name}</span>
                    <span style={{ color: overdue ? T.neg : T.muted, fontWeight: overdue ? 700 : 400 }}>
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
          <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 10 }}>Budgets this month</div>
          <div className="flex flex-col gap-3">
            {budgetRows.map((b) => {
              const c = expCatInfo(b.category);
              const over = b.pct >= 100;
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
                    <span style={{ color: T.ink }}>{b.category}</span>
                    <span style={{ color: over ? T.neg : T.muted }}>{money(b.spent)} / {money(b.limit)}</span>
                  </div>
                  <ProgressBar pct={b.pct} color={over ? T.neg : b.pct >= 80 ? T.warn : c.color} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>Recent activity</div>
          <button onClick={() => setTab("transactions")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>view all</button>
        </div>
        {recent.length === 0 ? (
          <div style={{ color: T.faint, fontSize: 12.5 }}>No transactions logged yet.</div>
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
  const color = isTransfer ? T.muted : tx.type === "income" ? T.pos : T.neg;
  return (
    <div className="flex items-center gap-3">
      <div style={{ width: 30, height: 30, borderRadius: 8, background: (isTransfer ? T.muted : c.color) + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={14} color={isTransfer ? T.muted : c.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tx.note || (isTransfer ? "Transfer" : tx.category)}
        </div>
        <div style={{ fontSize: 11, color: T.muted }}>
          {isTransfer ? `${accName(tx.accountId)} → ${accName(tx.toAccountId)}` : accName(tx.accountId)} · {fmtDateShort(tx.date)}
        </div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color, flexShrink: 0 }}>
        {isTransfer ? "" : tx.type === "income" ? "+" : "-"}{money(tx.amount).replace("-", "")}
      </div>
      {!compact && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onEdit(tx)} style={{ color: T.muted, padding: 4 }}><Pencil size={13} /></button>
          <button onClick={() => onDelete(tx)} style={{ color: T.neg, padding: 4 }}><Trash2 size={13} /></button>
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
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>Accounts & Top-Up Wallets</div>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5" style={{ background: T.ink, color: T.bg, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
          <Plus size={14} /> Add account
        </button>
      </div>

      {adding && (
        <Card>
          <div className="grid sm:grid-cols-3 gap-2">
            <FieldInput placeholder="Account name (e.g. Paytm, Metro Card)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <FieldSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </FieldSelect>
            <FieldInput type="number" step="0.01" placeholder="Starting balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={submitAdd} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ color: T.muted, fontSize: 13 }}>Cancel</button>
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
                    <button onClick={saveEdit} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ color: T.muted, fontSize: 12.5 }}>Cancel</button>
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
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{t.label}</div>
                </div>
              </div>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 700, color: a.balance < 0 ? T.neg : T.ink, marginBottom: 8 }}>
                {money(a.balance)}
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(a)} style={{ color: T.muted, padding: 4 }}><Pencil size={13} /></button>
                <button onClick={() => deleteAccount(a.id)} style={{ color: T.neg, padding: 4 }}><Trash2 size={13} /></button>
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
  const [error, setError] = useState("");

  const cats = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  // The "From / Account" dropdown visually defaults to the first account, so the
  // logic must default to it too. Previously form.accountId stayed "" until the
  // user manually changed the dropdown, and submit() silently bailed out.
  const effectiveAccountId = accounts.some((a) => a.id === form.accountId) ? form.accountId : (accounts[0]?.id ?? "");

  const quickPresets = [
    { label: "Chai / Snacks", category: "Food", amount: "50" },
    { label: "Metro / Auto", category: "Transport", amount: "60" },
    { label: "Lunch / Dinner", category: "Food", amount: "250" },
    { label: "Groceries", category: "Shopping", amount: "500" },
  ];

  const submit = () => {
    const amt = Number(form.amount);
    if (!effectiveAccountId) return setError("Pick an account first.");
    if (!form.amount || !isFinite(amt) || amt <= 0) return setError("Enter an amount greater than 0.");
    if (type === "transfer") {
      if (!form.toAccountId) return setError("Choose the account to transfer to.");
      if (form.toAccountId === effectiveAccountId) return setError("From and To accounts must be different.");
    }
    setError("");
    addTransaction({
      accountId: effectiveAccountId,
      toAccountId: type === "transfer" ? form.toAccountId : undefined,
      type,
      category: type === "transfer" ? undefined : (form.category || cats[0].name),
      amount: amt,
      note: form.note.trim(),
      date: form.date || todayISO(),
    });
    setForm({ accountId: effectiveAccountId, toAccountId: "", category: "", amount: "", note: "", date: todayISO() });
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
            { id: "expense", label: "Expense", icon: ArrowDownRight, color: T.neg },
            { id: "income", label: "Income / Top-Up", icon: ArrowUpRight, color: T.pos },
            { id: "transfer", label: "Transfer (Top-up Wallet)", icon: ArrowRightLeft, color: "#4A7FB5" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setType(opt.id); setError(""); setForm({ ...form, category: "", toAccountId: "" }); }}
              className="flex items-center gap-1.5"
              style={{ background: type === opt.id ? opt.color : T.bg, color: type === opt.id ? "#fff" : T.text2, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}
            >
              <opt.icon size={13} /> {opt.label}
            </button>
          ))}
        </div>

        {/* Quick Tag Presets */}
        {type === "expense" && (
          <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto pb-1">
            <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>Quick:</span>
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
          <FieldSelect value={effectiveAccountId} onChange={(e) => setForm({ ...form, accountId: e.target.value, toAccountId: e.target.value === form.toAccountId ? "" : form.toAccountId })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
          </FieldSelect>
          {type === "transfer" ? (
            <FieldSelect value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}>
              <option value="">To Top-Up Wallet / Target Account</option>
              {accounts.filter((a) => a.id !== effectiveAccountId).map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
              ))}
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
        {error && <div style={{ color: T.neg, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{error}</div>}
        <button onClick={submit} style={{ background: T.ink, color: T.bg, borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>
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
            <span style={{ color: T.muted }}>
              {visible.length} matches
            </span>
            {visibleExpenseTotal > 0 && <span style={{ color: T.neg, fontWeight: 700 }}>Spent: {money(visibleExpenseTotal)}</span>}
            {visibleIncomeTotal > 0 && <span style={{ color: T.pos, fontWeight: 700 }}>Received: {money(visibleIncomeTotal)}</span>}
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
                <div key={t.id} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
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
                    <button onClick={() => saveEdit(t)} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ color: T.muted, fontSize: 12.5 }}>Cancel</button>
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
      <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>Monthly budgets</div>
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
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, flex: 1 }}>{c.name}</div>
                {b && <div style={{ fontSize: 12, color: over ? T.neg : T.muted }}>{money(spent)} / {money(b.limit)}</div>}
              </div>
              {b && <div style={{ marginBottom: 10 }}><ProgressBar pct={pct} color={over ? T.neg : pct >= 80 ? T.warn : c.color} /></div>}
              <div className="flex gap-2">
                <FieldInput
                  type="number" step="0.01" placeholder="Monthly limit"
                  value={draft}
                  onChange={(e) => setLimitDrafts({ ...limitDrafts, [c.name]: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => upsertBudget(c.name, round2(Number(draft) || 0))}
                  style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700 }}
                >
                  {b ? "Update" : "Set"}
                </button>
                {b && (
                  <button onClick={() => { deleteBudget(c.name); setLimitDrafts({ ...limitDrafts, [c.name]: "" }); }} style={{ color: T.neg, padding: 8 }}>
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
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>Recurring bills & subscriptions</div>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5" style={{ background: T.ink, color: T.bg, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
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
            <button onClick={submit} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ color: T.muted, fontSize: 13 }}>Cancel</button>
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
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: T.muted }}>
                    {accName} · {FREQ_LABEL[r.frequency]} · <span style={{ color: overdue ? T.neg : T.muted, fontWeight: overdue ? 700 : 400 }}>
                      {overdue ? `${Math.abs(d)}d overdue` : d === 0 ? "due today" : `due in ${d}d`}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: r.type === "income" ? T.pos : T.neg, flexShrink: 0 }}>
                  {r.type === "income" ? "+" : "-"}{money(r.amount).replace("-", "")}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => markBillPaid(r)} className="flex items-center gap-1" style={{ background: T.pos, color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>
                  <Check size={12} /> Mark {r.type === "income" ? "received" : "paid"}
                </button>
                <button onClick={() => updateRecurring(r.id, { active: !r.active })} style={{ color: T.muted, fontSize: 12 }}>
                  {r.active ? "Pause" : "Resume"}
                </button>
                <button onClick={() => deleteRecurring(r.id)} style={{ color: T.neg, padding: 4, marginLeft: "auto" }}><Trash2 size={13} /></button>
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
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const startEdit = (d) => {
    setEditingId(d.id);
    setEditForm({ person: d.person, amount: String(d.amount), direction: d.direction, note: d.note || "", date: d.date || todayISO() });
  };
  const saveEdit = () => {
    if (!editForm.person.trim() || !(Number(editForm.amount) > 0)) return;
    updateDebt(editingId, {
      person: editForm.person,
      amount: editForm.amount,
      direction: editForm.direction,
      note: editForm.note.trim(),
      date: editForm.date,
    });
    setEditingId(null);
    setEditForm(null);
  };

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

  const shareMemberAll = async (person, items) => {
    if (!items.length) return;
    const message = buildMemberSummaryMessage(person, items);
    if (navigator.share) {
      try {
        await navigator.share({ text: message });
      } catch {
        // user cancelled share sheet
      }
    } else {
      setShareFallback({ debt: { person }, message });
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
          <StatCard label="Owed to you" value={money(owedToMe)} color={T.pos} />
          <StatCard label="You owe" value={money(iOwe)} color={T.neg} />
          <StatCard label="Net" value={money(round2(owedToMe - iOwe))} color={owedToMe - iOwe < 0 ? T.neg : T.ink} />
        </div>
      </Card>

      {/* Member Cards Grid */}
      <div className="flex items-center justify-between">
        <div className="font-display" style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>Members & Balances</div>
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
                      onClick={() => shareMemberAll(person, items)}
                      title="Share all open debts with this member"
                      className="text-sky-700 hover:text-sky-800 p-1"
                    >
                      <Share size={14} />
                    </button>
                  )}
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
                  style={{ color: net > 0 ? T.pos : net < 0 ? T.neg : T.muted }}
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
        <button type="submit" style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
          + Add Person
        </button>
      </form>

      {/* Filter and Log Bar */}
      <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ fontSize: 12, fontWeight: 600, color: T.muted }}>Filter:</span>
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
          style={{ background: T.ink, color: T.bg, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700 }}
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
              style={{ flex: 1, background: form.direction === "owed_to_me" ? T.pos : T.bg, color: form.direction === "owed_to_me" ? "#fff" : T.text2, borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700 }}
            >
              They owe me (I Lent)
            </button>
            <button
              onClick={() => setForm({ ...form, direction: "i_owe" })}
              style={{ flex: 1, background: form.direction === "i_owe" ? T.neg : T.bg, color: form.direction === "i_owe" ? "#fff" : T.text2, borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700 }}
            >
              I owe them (I Borrowed)
            </button>
          </div>

          <div className="flex items-center gap-1.5 mb-2 overflow-x-auto py-1">
            <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>Select person:</span>
            {members.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ ...form, person: m })}
                style={{
                  background: form.person === m ? T.ink : T.bg,
                  color: form.person === m ? "#fff" : T.text2,
                  fontSize: 11.5,
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontWeight: 600,
                  border: `1px solid ${T.line}`,
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
            <span style={{ fontSize: 11, color: T.muted }}>Quick amount:</span>
            {quickAmounts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setForm({ ...form, amount: String(q) })}
                style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.text2, borderRadius: 6, padding: "3px 8px", fontSize: 11.5, fontWeight: 600 }}
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
            <button onClick={submit} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>
              Save Debt
            </button>
            <button onClick={() => setAdding(false)} style={{ color: T.muted, fontSize: 13 }}>
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
              editingId === d.id && editForm ? (
                <div key={d.id} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => setEditForm({ ...editForm, direction: "owed_to_me" })} className={`flex-1 py-1.5 rounded text-xs font-bold ${editForm.direction === "owed_to_me" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>They owe me</button>
                    <button onClick={() => setEditForm({ ...editForm, direction: "i_owe" })} className={`flex-1 py-1.5 rounded text-xs font-bold ${editForm.direction === "i_owe" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}>I owe them</button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 mb-2">
                    <FieldInput list="debt-members-list" placeholder="Person" value={editForm.person} onChange={(e) => setEditForm({ ...editForm, person: e.target.value })} />
                    <FieldInput type="number" step="0.01" placeholder="Amount (₹)" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                  </div>
                  <datalist id="debt-members-list">{members.map((m) => <option key={m} value={m} />)}</datalist>
                  <div className="grid sm:grid-cols-2 gap-2 mb-2">
                    <FieldInput placeholder="Note (optional)" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
                    <FieldInput type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>Save</button>
                    <button onClick={() => { setEditingId(null); setEditForm(null); }} style={{ color: T.muted, fontSize: 12.5 }}>Cancel</button>
                  </div>
                </div>
              ) : (
              <div key={d.id} className="flex items-center gap-3">
                <div style={{ width: 32, height: 32, borderRadius: 8, background: (d.direction === "owed_to_me" ? T.pos : T.neg) + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User size={15} color={d.direction === "owed_to_me" ? T.pos : T.neg} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{d.person}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {d.direction === "owed_to_me" ? "owes you" : "you owe"} · {fmtDateShort(d.date)}{d.note ? ` · ${d.note}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: d.direction === "owed_to_me" ? T.pos : T.neg, flexShrink: 0 }}>
                  {money(d.amount)}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(d)} title="Edit" style={{ color: T.muted, padding: 4 }}><Pencil size={13} /></button>
                  <button onClick={() => shareDebt(d)} title="Share reminder" style={{ color: T.muted, padding: 4 }}><Share size={14} /></button>
                  <button onClick={() => updateDebt(d.id, { settled: true })} title="Mark settled" style={{ color: T.pos, padding: 4 }}><Check size={14} /></button>
                  <button onClick={() => deleteDebt(d.id)} style={{ color: T.neg, padding: 4 }}><Trash2 size={13} /></button>
                </div>
              </div>
              )
            ))}
          </div>
        )}
      </Card>

      {/* Settled List */}
      {settled.length > 0 && (
        <Card>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.muted, marginBottom: 8 }}>Settled History</div>
          <div className="flex flex-col gap-2">
            {settled.map((d) => (
              <div key={d.id} className="flex items-center gap-3" style={{ opacity: 0.65 }}>
                <div style={{ flex: 1, fontSize: 12.5, color: T.ink, textDecoration: "line-through" }}>
                  {d.person} — {money(d.amount)} {d.note ? `(${d.note})` : ""}
                </div>
                <button onClick={() => updateDebt(d.id, { settled: false })} style={{ fontSize: 11, color: T.muted, textDecoration: "underline" }}>reopen</button>
                <button onClick={() => deleteDebt(d.id)} style={{ color: T.neg, padding: 4 }}><Trash2 size={12} /></button>
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
        style={{ background: T.card, borderRadius: 16, padding: 20, maxWidth: 380, width: "100%", boxShadow: "0 10px 40px rgba(31,42,29,0.2)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-display" style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>Share with {debt.person}</div>
          <button onClick={onClose} style={{ color: T.muted }}><X size={16} /></button>
        </div>
        <div style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10, padding: 12, fontSize: 12.5, color: T.text2, lineHeight: 1.5, marginBottom: 14, whiteSpace: "pre-line", maxHeight: 260, overflowY: "auto" }}>
          {message}
        </div>
        <div className="flex flex-col gap-2">
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2"
            style={{ background: T.pos, color: "#fff", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
          >
            <MessageCircle size={15} /> Open in WhatsApp
          </a>
          <button
            onClick={copy}
            className="flex items-center justify-center gap-2"
            style={{ background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 700 }}
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
        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 14 }}>Income vs. expense — last 6 months</div>
        <div className="flex flex-col gap-3">
          {monthly.map((m) => (
            <div key={m.mk}>
              <div className="flex items-center justify-between mb-1" style={{ fontSize: 11.5, color: T.muted }}>
                <span>{monthLabel(m.mk)}</span>
                <span>+{money(m.income).slice(1)} / -{money(m.expense).slice(1)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <div style={{ background: T.soft, borderRadius: 5, height: 8 }}>
                  <div style={{ width: `${(m.income / maxVal) * 100}%`, background: T.pos, height: "100%", borderRadius: 5 }} />
                </div>
                <div style={{ background: T.soft, borderRadius: 5, height: 8 }}>
                  <div style={{ width: `${(m.expense / maxVal) * 100}%`, background: T.neg, height: "100%", borderRadius: 5 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 14 }}>This month's spending by category</div>
        {catTotals.length === 0 ? (
          <EmptyState icon={TrendingDown} text="No expenses logged this month yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {catTotals.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between mb-1" style={{ fontSize: 12 }}>
                  <span className="flex items-center gap-1.5" style={{ color: T.ink }}><c.icon size={12} color={c.color} /> {c.name}</span>
                  <span style={{ color: T.muted }}>{money(c.total)}</span>
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
