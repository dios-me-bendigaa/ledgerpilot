import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  ImportBatch,
  ImportRecord,
  NormalizationReport,
  NormalizationSummary,
  NormalizedTransaction,
  ReviewCandidate,
  SourceFormat,
  TransactionCategory,
  TransactionKind
} from '@ledgerpilot/core';

type NormalizationSource = {
  importRecordId: string;
  filePath: string;
  fileName: string;
};

type NormalizationOptions = {
  batch: ImportBatch;
  sources: NormalizationSource[];
  knownFingerprints: Set<string>;
  logger?: (message: string) => void;
  // Fallback currency for rows whose source CSV gives no per-row currency signal at all. Defaults
  // to 'CAD' (the historical hardcoded behavior) when not supplied, so existing callers/tests are
  // unaffected.
  homeCurrency?: string;
};

type NormalizationBatchResult = {
  report: NormalizationReport;
  transactions: NormalizedTransaction[];
};

type ParsedTransactionRow = {
  importRecordId: string;
  sourceFormat: SourceFormat;
  accountName: string;
  postedAt: string;
  postedDate: string;
  postedTime?: string;
  amount: number;
  currency: string;
  descriptionRaw: string;
  merchantNormalized: string;
  category: TransactionCategory;
  transactionKind: TransactionKind;
  confidenceScore: number;
  metadata: Record<string, string>;
  // Set when this row's amount was recovered heuristically from a malformed/ragged source row.
  // Downstream, this forces the row into the review queue regardless of category confidence,
  // since the amount itself — not just the category — is uncertain.
  parseWarning?: string;
  balanceAfter?: number;
};

type ParseRowsResult = {
  rows: ParsedTransactionRow[];
  malformedRowCount: number;
  droppedRowCount: number;
  malformedRowSamples: string[];
};

type TransferCandidate = {
  transaction: NormalizedTransaction;
  transferLike: boolean;
};

const strongCategoryRules: Array<{
  category: TransactionCategory;
  kind: TransactionKind;
  confidence: number;
  keywords: string[];
}> = [
  {
    category: 'salary',
    kind: 'income',
    confidence: 0.99,
    keywords: [
      'salary', 'payroll', 'direct deposit payroll', 'direct deposit pay', 'direct deposit',
      'virement salaire', 'depot salaire', 'paie directe', 'virement paie', 'depot paie',
      'biweekly pay', 'bi-weekly pay', 'remuneration', 'remuner', 'depot direct emploi',
      'pay deposit', 'employer deposit', 'employer payment'
    ]
  },
  {
    category: 'interest_income',
    kind: 'income',
    confidence: 0.95,
    keywords: ['interest paid', 'interest earned', 'interet credite', 'savings interest', 'interest income']
  },
  {
    category: 'refunds',
    kind: 'refund',
    confidence: 0.96,
    keywords: ['refund', 'reversal', 'returned', 'remboursement', 'credit adjustment']
  },
  {
    category: 'credit_card_payments',
    kind: 'payment',
    confidence: 0.95,
    keywords: [
      'credit card payment', 'visa payment', 'mastercard payment',
      'paiement carte', 'paiement merci', 'payment thank you',
      'cc payment', 'crt paymt', 'card payment', 'pmt carte'
    ]
  },
  {
    category: 'mortgage_payments',
    kind: 'payment',
    confidence: 0.94,
    keywords: ['mortgage', 'hypotheque', 'paiement hypotheque']
  },
  {
    category: 'line_of_credit_payments',
    kind: 'payment',
    confidence: 0.93,
    keywords: ['line of credit', 'loc payment', 'marge de credit', 'avance marge', 'ligne de credit', 'credit line advance']
  },
  {
    category: 'interac_e_transfers',
    kind: 'transfer',
    confidence: 0.94,
    keywords: ['interac', 'e-transfer', 'etransfer', 'virement interac']
  },
  {
    category: 'bill_payments',
    kind: 'payment',
    confidence: 0.92,
    keywords: ['bill payment', 'pre-authorized debit', 'pad ', 'paiement facture', 'debit preautori', 'preauthorized payment']
  },
  {
    category: 'utilities',
    kind: 'expense',
    confidence: 0.9,
    keywords: [
      'hydro', 'electric', 'water bill', 'internet', 'utility',
      'bell canada', 'rogers', 'telus', 'videotron', 'cogeco', 'shaw',
      'hydro-quebec', 'hydro quebec', 'enbridge', 'naturgy'
    ]
  },
  {
    category: 'groceries',
    kind: 'expense',
    confidence: 0.9,
    keywords: [
      'grocery', 'supermarket', 'costco', 'walmart', 'wal mart', 'loblaws', 'real canadian superstore', 'superstore',
      'sobeys', 'provigo', 'no frills', 'food basics', 'freshco', 'farm boy', 'longos',
      'whole foods', 'maxi ', 'super c', 'iga ', 'metro '
    ]
  },
  {
    category: 'restaurants',
    kind: 'expense',
    confidence: 0.89,
    keywords: [
      'restaurant', 'uber eats', 'doordash', 'cafe', 'coffee',
      'tim hortons', 'tims ', 'starbucks', 'mcdonald', 'harvey harvey',
      'burger king', 'wendys', 'subway', 'pizza', 'sushi',
      'skip the dishes', 'skipthedishes', 'boulangerie', 'patisserie'
    ]
  },
  {
    category: 'fuel',
    kind: 'expense',
    confidence: 0.89,
    keywords: ['shell', 'esso', 'petro', 'fuel', 'gas station', 'ultramar', 'couche tard', 'circle k']
  },
  {
    category: 'shopping',
    kind: 'expense',
    confidence: 0.87,
    keywords: [
      'amazon', 'shop', 'store', 'retail',
      'canadian tire', 'best buy', 'ikea', 'dollarama', 'sport chek',
      'winners', 'homesense', 'marshalls', 'simons', 'roots'
    ]
  },
  {
    category: 'travel',
    kind: 'expense',
    confidence: 0.88,
    keywords: [
      'airlines', 'hotel', 'airbnb', 'uber trip', 'uber', 'lyft', 'taxi',
      'air canada', 'westjet', 'via rail', 'expedia', 'booking.com'
    ]
  },
  {
    category: 'insurance',
    kind: 'expense',
    confidence: 0.9,
    keywords: ['insurance', 'assurance', 'intact', 'desjardins assurance']
  },
  {
    category: 'investments',
    kind: 'transfer',
    confidence: 0.9,
    keywords: ['brokerage', 'wealthsimple', 'invest', 'tfsa', 'rrsp', 'questrade', 'disnat', 'placement']
  },
  {
    category: 'interest_charges',
    kind: 'expense',
    confidence: 0.95,
    keywords: ['interest charge', 'interest charged', 'interet debit', 'frais interet']
  },
  {
    category: 'fees',
    kind: 'expense',
    confidence: 0.94,
    // 'nsf' alone is deliberately NOT a keyword here — it's a literal substring of "transfer"
    // ("tra-nsf-er"), so any transfer-related description (e-transfer, wire transfer, account
    // transfer, ...) would silently match this rule and get miscategorized as a fee. Requiring a
    // trailing "fee"/"charge" (as real NSF-fee line items actually read) avoids the collision.
    keywords: ['service fee', 'monthly fee', 'nsf fee', 'nsf charge', 'insufficient funds', 'frais mensuel', 'frais de service']
  },
  {
    category: 'taxes',
    kind: 'expense',
    confidence: 0.93,
    keywords: ['tax', 'cra', 'revenue agency', 'impot', 'revenu canada', 'agence revenu']
  },
  {
    category: 'bank_transfers',
    kind: 'transfer',
    confidence: 0.85,
    keywords: ['transfer to', 'transfer from', 'account transfer', 'online transfer', 'virement', 'transfert']
  }
];

const normalizeHeader = (header: string) =>
  header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const detectDelimiter = (firstLine: string): ',' | ';' | '\t' => {
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (semicolons > commas && semicolons > tabs) return ';';
  if (tabs > commas) return '\t';
  return ',';
};

const parseCsv = (content: string, delimiter?: ',' | ';' | '\t'): string[][] => {
  const firstNewline = content.indexOf('\n');
  const firstLine = firstNewline >= 0 ? content.slice(0, firstNewline) : content;
  const sep = delimiter ?? detectDelimiter(firstLine);

  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === sep && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
};

const detectSourceFormat = (headers: string[]): SourceFormat => {
  const normalizedHeaders = headers.map(normalizeHeader);
  const hasAmount = normalizedHeaders.some((h) =>
    ['amount', 'cad', 'cad amount', 'transaction amount', 'net amount'].includes(h)
  );
  const hasDebitLike = normalizedHeaders.some((h) =>
    ['debit', 'withdrawal', 'withdrawals', 'dr', 'withdrawal amount', 'charges'].includes(h)
  );
  const hasCreditLike = normalizedHeaders.some((h) =>
    ['credit', 'deposit', 'deposits', 'cr', 'deposit amount', 'payments'].includes(h)
  );
  const hasDebitAndCredit = hasDebitLike && hasCreditLike;
  const isRbc =
    normalizedHeaders.includes('transaction date') &&
    normalizedHeaders.includes('description 1') &&
    normalizedHeaders.some((header) => header.includes('cad'));

  if (isRbc) {
    return 'rbc';
  }

  if (hasDebitAndCredit) {
    return 'generic-debit-credit';
  }

  if (hasAmount) {
    return 'generic-amount';
  }

  return 'unknown';
};

const findColumn = (headers: string[], candidates: string[]) => {
  const normalizedHeaders = headers.map(normalizeHeader);
  return normalizedHeaders.findIndex((header) => candidates.includes(header));
};

// Words that show up in almost every real bank-export header row, regardless of exact column
// naming. Used to detect files that have NO header row at all (some CIBC credit card exports:
// data starts on line 1, e.g. `2026-07-08,"MERCHANT NAME",13.37,`) — without this check, the
// first DATA row gets silently treated as headers, every column-detection lookup below fails to
// match anything (real values like "2026-07-08" don't match the word "date"), every row's amount
// resolves to 0 via the all-columns-unmatched fallback, and the entire file's transactions are
// silently dropped as benign zero-amount rows with NO error, warning, or reduced confidence —
// the import reports "completed" while quietly importing nothing.
const headerLikeWords = [
  'date', 'description', 'amount', 'debit', 'credit', 'balance', 'transaction', 'details',
  'merchant', 'payee', 'category', 'account', 'memo', 'reference', 'narrative', 'type', 'currency'
];

const looksLikeHeaderRow = (candidateRow: string[]): boolean => {
  const normalized = candidateRow.map(normalizeHeader);
  return normalized.some((cell) => headerLikeWords.some((word) => cell.includes(word)));
};

// Best-effort column labels for a file with no real header row, assigned purely by position.
// Matches the most common minimal bank-export shape (date, description, amount, ...anything
// else). Deliberately conservative — this only decides what to call each column for the
// downstream findColumn() lookups below; it doesn't change how any value is parsed.
const positionalHeaderGuess = (columnCount: number): string[] => {
  const base = ['Date', 'Description', 'Amount'];
  const headers = base.slice(0, columnCount);
  while (headers.length < columnCount) {
    headers.push(`Column${headers.length + 1}`);
  }
  return headers;
};

const parseAmount = (value: string) => {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) {
    return 0;
  }

  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    return Number.parseFloat(`-${normalized.slice(1, -1)}`);
  }

  return Number.parseFloat(normalized);
};

const isFiniteNonZero = (value: number) => Number.isFinite(value) && value !== 0;

// Conservative fallback for rows whose column count doesn't match the header (e.g. a stray extra
// delimiter, or an unescaped comma inside a description field, shifted the real amount over by one
// column). We deliberately do NOT try to guess *which* column is the "correct" one — that risks
// silently producing a wrong-but-plausible number, which is worse than a visible gap. Instead we
// scan for the rightmost cell that parses as a finite, non-zero amount, since bank exports
// overwhelmingly place the amount near the end of the row, with any spurious/missing cell being
// empty rather than containing unrelated numeric data.
// `parseAmount` is deliberately lenient (used on cells we already know are amount-shaped), but
// that leniency is dangerous for scanRowForAmount's blind recovery scan: JS's Number.parseFloat
// only consumes a leading numeric *prefix* — parseFloat('2026-01-02') is 2026, not NaN — so a
// naive scan over every cell in a ragged row can mistake a plain ISO date string for a dollar
// amount. This stricter check requires the ENTIRE cleaned cell to be numeric, not just a prefix.
const looksLikeWholeAmount = (value: string): boolean => {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) return false;
  const unwrapped =
    normalized.startsWith('(') && normalized.endsWith(')') ? `-${normalized.slice(1, -1)}` : normalized;
  return /^-?\d+(\.\d+)?$/.test(unwrapped);
};

const scanRowForAmount = (row: string[], excludeIndices: ReadonlySet<number> = new Set()): number | undefined => {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (excludeIndices.has(index)) continue;
    const raw = row[index] ?? '';
    if (!looksLikeWholeAmount(raw)) continue;
    const candidate = parseAmount(raw);
    if (isFiniteNonZero(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

type AmountColumnIndices = {
  amountIndex: number;
  cadAmountIndex: number;
  usdAmountIndex: number;
  currencyCodeIndex: number;
  creditIndex: number;
  debitIndex: number;
};

// Resolves both the amount AND its currency for one row. Real-world dual-currency account
// exports (e.g. RBC's CAD$/USD$ columns) put a row's actual amount in whichever currency's column
// is non-empty for THAT row — a USD-denominated transaction leaves the CAD$ cell blank and vice
// versa. Previously only the CAD-labeled column was ever read, and every row was tagged 'CAD'
// unconditionally: a USD-only row resolved to amount 0 and was silently dropped by the zero-amount
// filter (reproducible against the shipped RBC fixtures, which do carry a populated USD$ column).
const resolveAmountAndCurrency = (
  row: string[],
  indices: AmountColumnIndices,
  homeCurrency: string,
): { amount: number; currency: string } => {
  const { amountIndex, cadAmountIndex, usdAmountIndex, currencyCodeIndex, creditIndex, debitIndex } = indices;
  const explicitCurrency = currencyCodeIndex >= 0 ? (row[currencyCodeIndex] ?? '').trim().toUpperCase() : '';

  const primary = amountIndex >= 0 ? parseAmount(row[amountIndex] ?? '') : undefined;
  if (primary !== undefined && isFiniteNonZero(primary)) {
    const currency =
      explicitCurrency ||
      (amountIndex === usdAmountIndex ? 'USD' : amountIndex === cadAmountIndex ? 'CAD' : homeCurrency);
    return { amount: primary, currency };
  }

  // Primary amount column was empty/zero for this row — check sibling foreign-currency columns
  // before giving up, since a per-currency dual-column layout means "empty" here is expected for
  // rows denominated in the OTHER column's currency, not a sign the row has no amount at all.
  if (usdAmountIndex >= 0 && usdAmountIndex !== amountIndex) {
    const usdValue = parseAmount(row[usdAmountIndex] ?? '');
    if (isFiniteNonZero(usdValue)) {
      return { amount: usdValue, currency: 'USD' };
    }
  }
  if (cadAmountIndex >= 0 && cadAmountIndex !== amountIndex) {
    const cadValue = parseAmount(row[cadAmountIndex] ?? '');
    if (isFiniteNonZero(cadValue)) {
      return { amount: cadValue, currency: 'CAD' };
    }
  }

  if (primary !== undefined) {
    return { amount: primary, currency: explicitCurrency || homeCurrency };
  }

  return {
    amount: parseAmount(row[creditIndex] ?? '') - parseAmount(row[debitIndex] ?? ''),
    currency: explicitCurrency || homeCurrency
  };
};

const parseDateValue = (dateValue: string, timeValue?: string) => {
  const raw = [dateValue, timeValue].filter(Boolean).join(' ').trim();
  const direct = new Date(raw);

  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = dateValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const [, first, second, year] = match;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    const iso = `${normalizedYear}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
    return new Date(timeValue ? `${iso}T${timeValue}` : iso);
  }

  return new Date();
};

const normalizeMerchant = (description: string) =>
  description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining accent marks: e.g. é\u2192e
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Merchant-specific overrides that must win over the bank's own Category column. The bank lumps
// Remitly remittances under "Transfer", but the user tracks them as India expenses.
const merchantOverrides: Array<{
  match: string;
  category: TransactionCategory;
  kind: TransactionKind;
}> = [
  { match: 'remitly', category: 'india_expenses', kind: 'expense' },
  // TIPP = Winnipeg's Tax Instalment Payment Plan — a property-tax draft, even when the bank
  // labels it generically "Taxes".
  { match: 'tipp', category: 'property_tax', kind: 'expense' },
  // NBC LOC uses "Bank fee" as bank category for interest rows — override so it lands in
  // interest_charges, not fees.
  { match: 'interest to be paid', category: 'interest_charges', kind: 'expense' },
  // NBC LOC payment rows — both in chequing (debit) and LOC (credit) — are labeled "Transfer"
  // by the bank, but represent LOC principal/interest payments.
  { match: 'authorized transaction on line of credit', category: 'line_of_credit_payments', kind: 'payment' },
  { match: 'overdue transfer line of credit', category: 'line_of_credit_payments', kind: 'payment' },
  // Scotia LOC payment format: "payment from - *****xx*xx xx" (masked account number)
  { match: 'payment from - ', category: 'line_of_credit_payments', kind: 'payment' }
];

// Maps a bank statement's own Category column value -> app category + kind. This is a far stronger
// signal than description keyword-guessing, so it is consulted before the keyword rules. Ambiguous
// bank labels (e.g. "Cash", "Finances") are intentionally left unmapped so they fall to review.
const bankCategoryMap: Record<string, { category: TransactionCategory; kind: TransactionKind }> = {
  'salary': { category: 'salary', kind: 'income' },
  'revenue': { category: 'income', kind: 'income' },
  'income': { category: 'income', kind: 'income' },
  'interest income': { category: 'interest_income', kind: 'income' },
  'refund': { category: 'refunds', kind: 'refund' },
  'transfer': { category: 'internal_transfers', kind: 'internal_transfer' },
  'credit card payment': { category: 'credit_card_payments', kind: 'payment' },
  'investments': { category: 'investments', kind: 'transfer' },
  'line of credit': { category: 'line_of_credit_payments', kind: 'payment' },
  'loan': { category: 'line_of_credit_payments', kind: 'payment' },
  'car payment': { category: 'car_payments', kind: 'expense' },
  'rent': { category: 'rent', kind: 'expense' },
  'mortgage': { category: 'mortgage_payments', kind: 'payment' },
  'bills utilities': { category: 'bill_payments', kind: 'expense' },
  'bills and utilities': { category: 'bill_payments', kind: 'expense' },
  'utilities': { category: 'home_utilities', kind: 'expense' },
  'hydro': { category: 'home_utilities', kind: 'expense' },
  'water': { category: 'home_utilities', kind: 'expense' },
  'electricity': { category: 'home_utilities', kind: 'expense' },
  'mobile phone': { category: 'mobile', kind: 'expense' },
  'mobile': { category: 'mobile', kind: 'expense' },
  'phone': { category: 'mobile', kind: 'expense' },
  'internet': { category: 'internet', kind: 'expense' },
  'car insurance': { category: 'car_insurance', kind: 'expense' },
  'home insurance': { category: 'home_insurance', kind: 'expense' },
  'life insurance': { category: 'insurance', kind: 'expense' },
  'insurance': { category: 'insurance', kind: 'expense' },
  'groceries': { category: 'groceries', kind: 'expense' },
  'grocery': { category: 'groceries', kind: 'expense' },
  'fuel': { category: 'fuel', kind: 'expense' },
  'gas fuel': { category: 'fuel', kind: 'expense' },
  'gas and fuel': { category: 'fuel', kind: 'expense' },
  'restaurants': { category: 'restaurants', kind: 'expense' },
  'fast food': { category: 'restaurants', kind: 'expense' },
  'food dining': { category: 'restaurants', kind: 'expense' },
  'food and dining': { category: 'restaurants', kind: 'expense' },
  'gym': { category: 'lifestyle', kind: 'expense' },
  'personal care': { category: 'lifestyle', kind: 'expense' },
  'pharmacy': { category: 'lifestyle', kind: 'expense' },
  'health': { category: 'lifestyle', kind: 'expense' },
  'entertainment': { category: 'lifestyle', kind: 'expense' },
  'shopping': { category: 'shopping', kind: 'expense' },
  'clothing': { category: 'shopping', kind: 'expense' },
  'home furnishing': { category: 'shopping', kind: 'expense' },
  'electronics and software': { category: 'shopping', kind: 'expense' },
  'shipping': { category: 'shopping', kind: 'expense' },
  'travel': { category: 'travel', kind: 'expense' },
  'air travel': { category: 'travel', kind: 'expense' },
  'car rentals taxis': { category: 'travel', kind: 'expense' },
  'car rentals and taxis': { category: 'travel', kind: 'expense' },
  'vacation': { category: 'vacation', kind: 'expense' },
  'taxes': { category: 'taxes', kind: 'expense' },
  'fees': { category: 'fees', kind: 'expense' },
  'bank fee': { category: 'fees', kind: 'expense' },
  'finances': { category: 'fees', kind: 'expense' },
  'legal': { category: 'fees', kind: 'expense' },
  'interest': { category: 'interest_charges', kind: 'expense' }
};

const classifyTransaction = (descriptionRaw: string, amount: number, bankCategory?: string, accountName?: string) => {
  const normalizedDescription = normalizeMerchant(descriptionRaw);

  // 1. Merchant-specific overrides win over everything (e.g. Remitly -> india_expenses).
  const override = merchantOverrides.find((rule) => normalizedDescription.includes(rule.match));
  if (override) {
    return { category: override.category, transactionKind: override.kind, confidenceScore: 0.95 };
  }

  // 2. Trust the bank's own Category column when present and recognized.
  const mappedBankCategory = bankCategory ? bankCategoryMap[normalizeMerchant(bankCategory)] : undefined;
  if (mappedBankCategory) {
    return {
      category: mappedBankCategory.category,
      transactionKind: mappedBankCategory.kind,
      confidenceScore: 0.9
    };
  }

  // 2.5. Account-type context: credits (amount > 0) arriving in a known debt/credit-product
  // account are payment receipts that reduce the outstanding balance. This fires when the bank
  // description is generic (e.g. "Payment received") and no keyword rule would match.
  if (accountName && amount > 0) {
    const normalizedAccount = normalizeMerchant(accountName);
    if (/credit card|mastercard|visa|\bcc\b/.test(normalizedAccount)) {
      return { category: 'credit_card_payments' as const, transactionKind: 'payment' as const, confidenceScore: 0.87 };
    }
    if (/line of credit|\bloc\b|marge de credit|marge credit|ligne de credit/.test(normalizedAccount)) {
      return { category: 'line_of_credit_payments' as const, transactionKind: 'payment' as const, confidenceScore: 0.87 };
    }
    if (/mortgage|hypotheque/.test(normalizedAccount)) {
      return { category: 'mortgage_payments' as const, transactionKind: 'payment' as const, confidenceScore: 0.85 };
    }
    if (/car loan|auto loan|vehicle loan/.test(normalizedAccount)) {
      return { category: 'car_payments' as const, transactionKind: 'payment' as const, confidenceScore: 0.85 };
    }
  }

  // 3. Fall back to description keyword rules.
  if (
    normalizedDescription.includes('transfer to') ||
    normalizedDescription.includes('transfer from') ||
    normalizedDescription.includes('account transfer')
  ) {
    return {
      category: 'bank_transfers' as const,
      transactionKind: 'transfer' as const,
      confidenceScore: 0.9
    };
  }

  for (const rule of strongCategoryRules) {
    if (rule.keywords.some((keyword) => normalizedDescription.includes(keyword))) {
      return {
        category: rule.category,
        transactionKind: rule.kind,
        confidenceScore: rule.confidence
      };
    }
  }

  // 4. Unknown transactions go to review queue regardless of sign.
  return {
    category: 'unknown' as const,
    transactionKind: amount > 0 ? ('income' as const) : ('expense' as const),
    confidenceScore: 0.4
  };
};

const parseRecordRows = async (
  record: ImportRecord,
  filePath: string,
  logger: ((message: string) => void) | undefined,
  homeCurrency: string,
): Promise<ParseRowsResult> => {
  const content = await fs.readFile(filePath, 'utf8');
  const firstNewline = content.indexOf('\n');
  const firstLine = firstNewline >= 0 ? content.slice(0, firstNewline) : content;
  const delimiter = detectDelimiter(firstLine);
  const parsed = parseCsv(content, delimiter);
  if (parsed.length < 2) {
    logger?.(`parseRecordRows file="${record.fileName}" delimiter="${delimiter}" totalRows=${parsed.length} — skipped (no data rows)`);
    return { rows: [], malformedRowCount: 0, droppedRowCount: 0, malformedRowSamples: [] };
  }

  const [firstRow, ...remainingRows] = parsed;
  const hasRealHeader = looksLikeHeaderRow(firstRow);
  // No recognizable header word anywhere in row 1 -> treat it as the first DATA row instead of
  // discarding it, using a positional best guess for what each column means (see
  // positionalHeaderGuess). Every row from a file detected this way is flagged for review below
  // (parseWarning + confidence cap), same as ragged rows — the column mapping is a guess, not a
  // confirmed layout, so it shouldn't silently masquerade as full-confidence data.
  const headers = hasRealHeader ? firstRow : positionalHeaderGuess(firstRow.length);
  const rows = hasRealHeader ? remainingRows : parsed;
  const sourceFormat = detectSourceFormat(headers);
  logger?.(
    `parseRecordRows file="${record.fileName}" delimiter="${delimiter}" rawHeaderCount=${headers.length} ` +
    `headers="${headers.slice(0, 8).join('|')}" format=${sourceFormat} ` +
    `${hasRealHeader ? '' : '(no header row detected — using positional column guess) '}`
  );

  const dateIndex = findColumn(headers, [
    'date', 'transaction date', 'posted date', 'posting date',
    'trans date', 'trn date', 'value date', 'effective date', 'transaction dt'
  ]);
  const timeIndex = findColumn(headers, ['time']);
  const amountIndex = findColumn(headers, [
    'amount', 'cad', 'cad amount', 'cad$',
    'transaction amount', 'net amount', 'cad amount', 'amt'
  ]);
  // Sibling foreign-currency amount column (see resolveAmountAndCurrency) and an optional
  // explicit currency-code column, for files that use a generic amount + separate currency column
  // instead of one column per currency.
  const cadAmountIndex = findColumn(headers, ['cad', 'cad amount', 'cad$']);
  const usdAmountIndex = findColumn(headers, ['usd', 'usd amount', 'usd$']);
  const currencyCodeIndex = findColumn(headers, ['currency', 'ccy', 'iso currency code', 'currency code']);
  const debitIndex = findColumn(headers, [
    'debit', 'withdrawal', 'withdrawals', 'withdrawal amount',
    'dr', 'charges', 'debit amount'
  ]);
  const creditIndex = findColumn(headers, [
    'credit', 'deposit', 'deposits', 'deposit amount',
    'cr', 'payments', 'credit amount'
  ]);
  const descriptionIndex = findColumn(headers, [
    'description',
    'description 1',
    'details',
    'merchant',
    'payee',
    'transaction',
    'narrative',
    'memo',
    'reference',
    'particulars',
    'transaction details',
    'trans description',
    'trn description'
  ]);
  const description2Index = findColumn(headers, [
    'description 2', 'description2', 'memo', 'sub description', 'subdescription', 'details', 'particulars'
  ]);
  const accountIndex = findColumn(headers, ['account', 'account name', 'account number']);
  const categoryIndex = findColumn(headers, ['category', 'type', 'transaction type', 'categorie']);
  const balanceIndex = findColumn(headers, ['balance', 'running balance', 'account balance', 'ending balance', 'new balance', 'solde']);

  logger?.(
    `parseRecordRows file="${record.fileName}" columns: ` +
    `date=${dateIndex} amount=${amountIndex} debit=${debitIndex} ` +
    `credit=${creditIndex} desc=${descriptionIndex} dataRows=${rows.length}`
  );

  const malformedRowSamples: string[] = [];
  let malformedRowCount = 0;
  let droppedRowCount = 0;

  // Columns known NOT to be an amount, excluded from scanRowForAmount's recovery scan so it can't
  // mistake e.g. a plain date string for a dollar figure. balanceIndex is included deliberately:
  // a running-balance column almost always sits at the far right of bank exports, exactly where
  // the right-to-left recovery scan looks first, so an unrelated large balance would otherwise
  // consistently win over the real (possibly zero) transaction amount.
  const nonAmountIndices = new Set(
    [dateIndex, timeIndex, descriptionIndex, description2Index, accountIndex, categoryIndex, balanceIndex].filter(
      (index) => index >= 0,
    ),
  );

  const mapped: ParsedTransactionRow[] = [];

  for (const row of rows) {
    const dateValue = dateIndex >= 0 ? row[dateIndex] ?? '' : '';
    const timeValue = timeIndex >= 0 ? row[timeIndex] ?? '' : '';
    const descriptionParts = [
      descriptionIndex >= 0 ? row[descriptionIndex] ?? '' : '',
      description2Index >= 0 ? row[description2Index] ?? '' : ''
    ].filter(Boolean);
    const descriptionRaw = descriptionParts.join(' ').trim();

    // A row whose field count doesn't match the header is a strong signal that a stray/missing
    // delimiter has shifted every subsequent column resolution — the amount we're about to read
    // by fixed index may land on the wrong cell entirely (see scanRowForAmount below).
    const isRagged = row.length !== headers.length;

    let amount: number;
    let currency: string;
    let parseWarning: string | undefined;

    if (isRagged) {
      // Column alignment can't be trusted at all when the field count doesn't match the header —
      // including which column (if any) would normally indicate a foreign currency. Recover an
      // amount via a currency-agnostic scan of the raw row rather than risk mis-tagging a merely
      // shifted home-currency value as a foreign currency (resolveAmountAndCurrency's sibling-
      // column fallback would otherwise "find" the shifted value in the wrong currency's column).
      const recovered = scanRowForAmount(row, nonAmountIndices);
      amount = recovered ?? NaN;
      currency = homeCurrency;
      parseWarning =
        recovered !== undefined
          ? `Row had ${row.length} columns but the file header has ${headers.length}; amount was recovered heuristically from the raw row — please verify.`
          : `Row had ${row.length} columns but the file header has ${headers.length}, and no usable amount could be found.`;
    } else {
      const resolved = resolveAmountAndCurrency(
        row,
        { amountIndex, cadAmountIndex, usdAmountIndex, currencyCodeIndex, creditIndex, debitIndex },
        homeCurrency,
      );
      amount = resolved.amount;
      currency = resolved.currency;

      // Only trigger the recovery scan for a genuine parse failure (NaN) — NOT for a legitimately
      // resolved zero (e.g. Debit="0"/Credit="0" both present and explicit, which correctly
      // resolves to 0 - 0 = 0). Using isFiniteNonZero here previously conflated "this cell was
      // junk" with "this transaction really is $0", so a $0 placeholder/logging row (seen in real
      // NBC exports, e.g. a zero-amount "management fee" line) would get its amount silently
      // overwritten by whatever the recovery scan found elsewhere in the row — typically a
      // Balance column, since that's conventionally the rightmost column the scan checks first.
      if (Number.isNaN(amount) && descriptionRaw.length > 0) {
        // Column alignment is fine, but the amount cell itself contained non-numeric junk (NaN).
        // Try to recover a plausible amount from elsewhere in the row before giving up.
        const recovered = scanRowForAmount(row, nonAmountIndices);
        if (recovered !== undefined) {
          amount = recovered;
          parseWarning = 'Amount column contained a non-numeric value; a nearby numeric value was used instead — please verify.';
        }
      }
    }

    // The column mapping itself (not just this row's amount) was a guess for the whole file —
    // flag every row so it lands in the review queue regardless of how confidently the
    // description happened to keyword-match a category (same treatment as ragged rows).
    if (!hasRealHeader && !parseWarning) {
      parseWarning =
        'This file has no header row; column meaning (date/description/amount) was guessed positionally — please verify.';
    }

    if (!isFiniteNonZero(amount)) {
      // Nothing usable — but only count/report it as "malformed" (as opposed to a benign blank
      // row) when there was real content we're throwing away.
      droppedRowCount += 1;
      if (descriptionRaw.length > 0 || isRagged) {
        malformedRowCount += 1;
        if (malformedRowSamples.length < 5) {
          malformedRowSamples.push(row.join(delimiter === '\t' ? ' | ' : delimiter));
        }
      }
      continue;
    }

    const parsedDate = parseDateValue(dateValue, timeValue);
    const merchantNormalized = normalizeMerchant(descriptionRaw);
    const bankCategory = categoryIndex >= 0 ? row[categoryIndex] ?? '' : '';
    const accountName =
      accountIndex >= 0 && row[accountIndex]
        ? row[accountIndex]
        : path.basename(record.fileName, path.extname(record.fileName));
    const classification = classifyTransaction(descriptionRaw, amount, bankCategory, accountName);
    // Only trust a ragged row's positional balance column when the row wasn't misaligned — same
    // reasoning as currency detection above, a shifted column could easily look like a plausible
    // (but wrong) number.
    const rawBalance = !isRagged && balanceIndex >= 0 ? row[balanceIndex] ?? '' : '';
    const balanceAfter = rawBalance && looksLikeWholeAmount(rawBalance) ? parseAmount(rawBalance) : undefined;

    const metadata = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    if (isRagged) {
      // The header-keyed zip above silently truncates/misaligns extra or missing cells — stash
      // the untouched raw row too so the original source line is never fully lost from view.
      metadata['_rawRow'] = JSON.stringify(row);
    }

    if (parseWarning) {
      malformedRowCount += 1;
      if (malformedRowSamples.length < 5) {
        malformedRowSamples.push(row.join(delimiter === '\t' ? ' | ' : delimiter));
      }
    }

    mapped.push({
      importRecordId: record.id,
      sourceFormat,
      accountName,
      postedAt: parsedDate.toISOString(),
      postedDate: parsedDate.toISOString().slice(0, 10),
      postedTime: timeValue || undefined,
      amount,
      currency: currency || homeCurrency,
      descriptionRaw,
      merchantNormalized,
      category: classification.category,
      transactionKind: classification.transactionKind,
      // A row we had to heuristically recover from malformed input can't be trusted at the
      // classifier's usual confidence — force it below the review threshold regardless of how
      // confidently the description happened to keyword-match a category.
      confidenceScore: parseWarning ? Math.min(classification.confidenceScore, 0.5) : classification.confidenceScore,
      metadata,
      parseWarning,
      balanceAfter
    } satisfies ParsedTransactionRow);
  }

  logger?.(
    `parseRecordRows file="${record.fileName}" accepted=${mapped.length}/${rows.length} ` +
    `(dropped ${droppedRowCount} rows with no usable amount; ${malformedRowCount} malformed/ragged rows flagged for review)`
  );
  return { rows: mapped, malformedRowCount, droppedRowCount, malformedRowSamples };
};

// `occurrence` disambiguates genuinely repeated rows (two identical same-day transactions post
// separately at the bank). Without it, the second identical row is wrongly dropped as a duplicate.
// The index is assigned in file order, so re-importing the same file yields the same fingerprints
// and true cross-import duplicates are still caught.
const makeFingerprint = (row: ParsedTransactionRow, occurrence: number) =>
  crypto
    .createHash('sha256')
    .update(`${row.accountName}|${row.postedDate}|${row.amount.toFixed(2)}|${row.merchantNormalized}|${occurrence}`)
    .digest('hex');

const isTransferLike = (transaction: NormalizedTransaction) =>
  [
    'bank_transfers', 'internal_transfers',
    'credit_card_payments', 'line_of_credit_payments', 'interac_e_transfers', 'investments',
    'mortgage_payments', 'car_payments'
  ].includes(transaction.category);

const dateNeighbours = (date: string): string[] => {
  const d = new Date(date);
  const prev = new Date(d);
  prev.setDate(d.getDate() - 1);
  const next = new Date(d);
  next.setDate(d.getDate() + 1);
  return [prev.toISOString().slice(0, 10), date, next.toISOString().slice(0, 10)];
};

const markInternalTransfers = (transactions: NormalizedTransaction[]) => {
  // Index debit candidates by amount|date — include neighbour dates (±1 day) so cross-account
  // payments that post on different days (chequing vs credit card) are still matched.
  const debitIndex = new Map<string, TransferCandidate>();
  const creditIndex = new Map<string, TransferCandidate[]>();

  transactions.forEach((transaction) => {
    const amountKey = Math.abs(transaction.amount).toFixed(2);
    if (transaction.amount < 0 && isTransferLike(transaction)) {
      const key = `${amountKey}|${transaction.postedDate}`;
      if (!debitIndex.has(key)) {
        debitIndex.set(key, { transaction, transferLike: true });
      }
    } else if (transaction.amount > 0) {
      for (const date of dateNeighbours(transaction.postedDate)) {
        const key = `${amountKey}|${date}`;
        const bucket = creditIndex.get(key) ?? [];
        bucket.push({ transaction, transferLike: isTransferLike(transaction) });
        creditIndex.set(key, bucket);
      }
    }
  });

  const paired = new Set<string>();

  for (const [key, debitEntry] of debitIndex) {
    if (paired.has(debitEntry.transaction.id)) continue;
    const credits = creditIndex.get(key) ?? [];
    // Require the credit side to itself look transfer-like (not just "some positive amount that
    // happens to match"). Without this check, an unrelated same-amount salary deposit or refund
    // landing in a different account within the ±1-day window would be silently recategorized as
    // an internal transfer, hiding real income from the dashboard. `transferLike` was previously
    // computed but never consulted here.
    const credit = credits.find(
      (c) => !paired.has(c.transaction.id) && c.transaction.accountName !== debitEntry.transaction.accountName && c.transferLike
    );
    if (!credit) continue;

    paired.add(debitEntry.transaction.id);
    paired.add(credit.transaction.id);

    debitEntry.transaction.isInternalTransfer = true;
    credit.transaction.isInternalTransfer = true;
    // Preserve the debit side's category so payment categories (line_of_credit_payments,
    // credit_card_payments, etc.) survive pairing and remain visible in the debt section.
    // Only suppress the credit side — it's the mirror entry in the receiving account.
    credit.transaction.category = 'internal_transfers';
    credit.transaction.transactionKind = 'internal_transfer';
    debitEntry.transaction.transferPairKey = key;
    credit.transaction.transferPairKey = key;
  }
};

const createSummary = (
  transactions: NormalizedTransaction[],
  malformedRowCount: number,
  droppedRowCount: number,
  malformedRowSamples: string[]
) => {
  const sourceFormats: Record<string, number> = {};
  const categories: Record<string, number> = {};

  transactions.forEach((transaction) => {
    sourceFormats[transaction.sourceFormat] = (sourceFormats[transaction.sourceFormat] ?? 0) + 1;
    categories[transaction.category] = (categories[transaction.category] ?? 0) + 1;
  });

  const postedDates = transactions.map((transaction) => transaction.postedDate).sort();

  return {
    totalRows: transactions.length,
    insertedTransactions: transactions.filter((transaction) => !transaction.isDuplicate).length,
    duplicateTransactions: transactions.filter((transaction) => transaction.isDuplicate).length,
    internalTransfers: transactions.filter((transaction) => transaction.isInternalTransfer).length,
    lowConfidenceTransactions: transactions.filter((transaction) => transaction.requiresReview).length,
    sourceFormats,
    categories,
    accounts: [...new Set(transactions.map((transaction) => transaction.accountName))],
    dateRange:
      postedDates.length > 0
        ? {
            start: postedDates[0] ?? '',
            end: postedDates[postedDates.length - 1] ?? ''
          }
        : undefined,
    malformedRowCount,
    droppedRowCount,
    malformedRowSamples
  } satisfies NormalizationSummary;
};

export class NormalizationEngine {
  async normalizeBatch(options: NormalizationOptions): Promise<NormalizationBatchResult> {
    const parsedRows: ParsedTransactionRow[] = [];
    let malformedRowCount = 0;
    let droppedRowCount = 0;
    const malformedRowSamples: string[] = [];
    const homeCurrency = options.homeCurrency ?? 'CAD';

    for (const source of options.sources) {
      const record = options.batch.files.find((entry) => entry.id === source.importRecordId);
      if (!record) {
        continue;
      }

      const result = await parseRecordRows(record, source.filePath, options.logger, homeCurrency);
      parsedRows.push(...result.rows);
      malformedRowCount += result.malformedRowCount;
      droppedRowCount += result.droppedRowCount;
      malformedRowSamples.push(...result.malformedRowSamples.slice(0, Math.max(0, 5 - malformedRowSamples.length)));
    }

    parsedRows.sort((left, right) => left.postedAt.localeCompare(right.postedAt));

    const seenFingerprints = new Set<string>();
    const occurrenceCounts = new Map<string, number>();
    const transactions = parsedRows.map<NormalizedTransaction>((row) => {
      // Count identical rows (same account/date/amount/merchant) in file order so repeats stay distinct.
      const baseKey = `${row.accountName}|${row.postedDate}|${row.amount.toFixed(2)}|${row.merchantNormalized}`;
      const occurrence = occurrenceCounts.get(baseKey) ?? 0;
      occurrenceCounts.set(baseKey, occurrence + 1);
      const fingerprint = makeFingerprint(row, occurrence);
      const isDuplicate = seenFingerprints.has(fingerprint) || options.knownFingerprints.has(fingerprint);
      seenFingerprints.add(fingerprint);
      const transactionId = crypto.randomUUID();

      return {
        id: transactionId,
        batchId: options.batch.id,
        importRecordId: row.importRecordId,
        sourceFormat: row.sourceFormat,
        accountName: row.accountName,
        postedAt: row.postedAt,
        postedDate: row.postedDate,
        postedTime: row.postedTime,
        amount: row.amount,
        currency: row.currency,
        descriptionRaw: row.descriptionRaw,
        merchantNormalized: row.merchantNormalized,
        category: row.category,
        transactionKind: row.transactionKind,
        confidenceScore: row.confidenceScore,
        fingerprint,
        isDuplicate,
        isInternalTransfer: false,
        requiresReview: row.confidenceScore < 0.7,
        metadataJson: JSON.stringify(row.metadata),
        balanceAfter: row.balanceAfter
      };
    });

    markInternalTransfers(transactions.filter((transaction) => !transaction.isDuplicate));

    const report: NormalizationReport = {
      id: crypto.randomUUID(),
      batchId: options.batch.id,
      createdAt: new Date().toISOString(),
      summary: createSummary(transactions, malformedRowCount, droppedRowCount, malformedRowSamples),
      flaggedTransactions: transactions
        .filter((transaction) => transaction.requiresReview)
        .slice(0, 10)
        .map<ReviewCandidate>((transaction) => ({
          transactionId: transaction.id,
          description: transaction.descriptionRaw,
          amount: transaction.amount,
          category: transaction.category,
          confidenceScore: transaction.confidenceScore,
          accountName: transaction.accountName
        }))
    };

    return { report, transactions };
  }
}
