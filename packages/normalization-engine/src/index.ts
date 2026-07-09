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
  { category: 'salary', kind: 'income', confidence: 0.99, keywords: ['salary', 'payroll', 'direct deposit payroll'] },
  { category: 'refunds', kind: 'refund', confidence: 0.96, keywords: ['refund', 'reversal', 'returned'] },
  { category: 'credit_card_payments', kind: 'payment', confidence: 0.95, keywords: ['credit card payment', 'visa payment', 'mastercard payment'] },
  { category: 'mortgage_payments', kind: 'payment', confidence: 0.94, keywords: ['mortgage'] },
  { category: 'line_of_credit_payments', kind: 'payment', confidence: 0.93, keywords: ['line of credit', 'loc payment'] },
  { category: 'interac_e_transfers', kind: 'transfer', confidence: 0.94, keywords: ['interac', 'e-transfer', 'etransfer'] },
  { category: 'bill_payments', kind: 'payment', confidence: 0.92, keywords: ['bill payment', 'pre-authorized debit', 'pad '] },
  { category: 'utilities', kind: 'expense', confidence: 0.9, keywords: ['hydro', 'electric', 'water', 'internet', 'mobile', 'utility'] },
  { category: 'groceries', kind: 'expense', confidence: 0.9, keywords: ['grocery', 'supermarket', 'costco', 'walmart', 'loblaws'] },
  { category: 'restaurants', kind: 'expense', confidence: 0.89, keywords: ['restaurant', 'uber eats', 'doordash', 'cafe', 'coffee'] },
  { category: 'fuel', kind: 'expense', confidence: 0.89, keywords: ['shell', 'esso', 'petro', 'fuel', 'gas station'] },
  { category: 'shopping', kind: 'expense', confidence: 0.87, keywords: ['amazon', 'shop', 'store', 'retail'] },
  { category: 'travel', kind: 'expense', confidence: 0.88, keywords: ['airlines', 'hotel', 'airbnb', 'uber trip', 'lyft'] },
  { category: 'insurance', kind: 'expense', confidence: 0.9, keywords: ['insurance', 'assurance'] },
  { category: 'investments', kind: 'transfer', confidence: 0.9, keywords: ['brokerage', 'wealthsimple', 'invest', 'tfsa', 'rrsp'] },
  { category: 'interest_charges', kind: 'expense', confidence: 0.95, keywords: ['interest charge', 'interest charged'] },
  { category: 'interest_income', kind: 'income', confidence: 0.95, keywords: ['interest paid', 'interest earned'] },
  { category: 'fees', kind: 'expense', confidence: 0.94, keywords: ['service fee', 'monthly fee', 'nsf', 'fee'] },
  { category: 'taxes', kind: 'expense', confidence: 0.93, keywords: ['tax', 'cra', 'revenue agency'] },
  {
    category: 'bank_transfers',
    kind: 'transfer',
    confidence: 0.85,
    keywords: ['transfer to', 'transfer from', 'account transfer', 'online transfer']
  }
];

const normalizeHeader = (header: string) =>
  header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const parseCsv = (content: string): string[][] => {
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

    if (character === ',' && !inQuotes) {
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
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const classifyTransaction = (descriptionRaw: string, amount: number) => {
  const normalizedDescription = normalizeMerchant(descriptionRaw);

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

  if (amount > 0) {
    return {
      category: 'income' as const,
      transactionKind: 'income' as const,
      confidenceScore: 0.72
    };
  }

  return {
    category: 'unknown' as const,
    transactionKind: 'expense' as const,
    confidenceScore: 0.45
  };
};

const parseRecordRows = async (
  record: ImportRecord,
  filePath: string,
): Promise<ParsedTransactionRow[]> => {
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = parseCsv(content);
  if (parsed.length < 2) {
    return [];
  }

  const [headers, ...rows] = parsed;
  const sourceFormat = detectSourceFormat(headers);

  const dateIndex = findColumn(headers, [
    'date', 'transaction date', 'posted date', 'posting date',
    'trans date', 'trn date', 'value date', 'effective date', 'transaction dt'
  ]);
  const timeIndex = findColumn(headers, ['time']);
  const amountIndex = findColumn(headers, [
    'amount', 'cad', 'cad amount', 'cad$',
    'transaction amount', 'net amount', 'cad amount', 'amt'
  ]);
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
  const description2Index = findColumn(headers, ['description 2', 'description2', 'memo']);
  const accountIndex = findColumn(headers, ['account', 'account name', 'account number']);

  return rows
    .map((row) => {
      const dateValue = dateIndex >= 0 ? row[dateIndex] ?? '' : '';
      const timeValue = timeIndex >= 0 ? row[timeIndex] ?? '' : '';
      const descriptionParts = [
        descriptionIndex >= 0 ? row[descriptionIndex] ?? '' : '',
        description2Index >= 0 ? row[description2Index] ?? '' : ''
      ].filter(Boolean);
      const descriptionRaw = descriptionParts.join(' ').trim();
      const amount =
        amountIndex >= 0
          ? parseAmount(row[amountIndex] ?? '')
          : parseAmount(row[creditIndex] ?? '') - parseAmount(row[debitIndex] ?? '');
      const parsedDate = parseDateValue(dateValue, timeValue);
      const merchantNormalized = normalizeMerchant(descriptionRaw);
      const classification = classifyTransaction(descriptionRaw, amount);
      const accountName =
        accountIndex >= 0 && row[accountIndex]
          ? row[accountIndex]
          : path.basename(record.fileName, path.extname(record.fileName));

      return {
        importRecordId: record.id,
        sourceFormat,
        accountName,
        postedAt: parsedDate.toISOString(),
        postedDate: parsedDate.toISOString().slice(0, 10),
        postedTime: timeValue || undefined,
        amount,
        currency: 'CAD',
        descriptionRaw,
        merchantNormalized,
        category: classification.category,
        transactionKind: classification.transactionKind,
        confidenceScore: classification.confidenceScore,
        metadata: Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
      } satisfies ParsedTransactionRow;
    })
    .filter((row) => row.descriptionRaw.length > 0 && row.amount !== 0);
};

const makeFingerprint = (row: ParsedTransactionRow) =>
  crypto
    .createHash('sha256')
    .update(`${row.accountName}|${row.postedDate}|${row.amount.toFixed(2)}|${row.merchantNormalized}`)
    .digest('hex');

const isTransferLike = (transaction: NormalizedTransaction) =>
  ['bank_transfers', 'credit_card_payments', 'line_of_credit_payments', 'interac_e_transfers', 'investments'].includes(
    transaction.category,
  );

const markInternalTransfers = (transactions: NormalizedTransaction[]) => {
  const candidates = new Map<string, TransferCandidate[]>();

  transactions.forEach((transaction) => {
    const key = `${Math.abs(transaction.amount).toFixed(2)}|${transaction.postedDate}`;
    const entry = candidates.get(key) ?? [];
    entry.push({ transaction, transferLike: isTransferLike(transaction) });
    candidates.set(key, entry);
  });

  for (const [key, bucket] of candidates) {
    if (bucket.length < 2) {
      continue;
    }

    const debit = bucket.find((entry) => entry.transaction.amount < 0 && entry.transferLike);
    const credit = bucket.find((entry) => entry.transaction.amount > 0 && entry.transferLike);

    if (!debit || !credit) {
      continue;
    }

    if (debit.transaction.accountName === credit.transaction.accountName) {
      continue;
    }

    debit.transaction.isInternalTransfer = true;
    credit.transaction.isInternalTransfer = true;
    debit.transaction.category = 'internal_transfers';
    credit.transaction.category = 'internal_transfers';
    debit.transaction.transactionKind = 'internal_transfer';
    credit.transaction.transactionKind = 'internal_transfer';
    debit.transaction.transferPairKey = key;
    credit.transaction.transferPairKey = key;
  }
};

const createSummary = (transactions: NormalizedTransaction[]) => {
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
        : undefined
  } satisfies NormalizationSummary;
};

export class NormalizationEngine {
  async normalizeBatch(options: NormalizationOptions): Promise<NormalizationBatchResult> {
    const parsedRows: ParsedTransactionRow[] = [];

    for (const source of options.sources) {
      const record = options.batch.files.find((entry) => entry.id === source.importRecordId);
      if (!record) {
        continue;
      }

      parsedRows.push(...(await parseRecordRows(record, source.filePath)));
    }

    parsedRows.sort((left, right) => left.postedAt.localeCompare(right.postedAt));

    const seenFingerprints = new Set<string>();
    const transactions = parsedRows.map<NormalizedTransaction>((row) => {
      const fingerprint = makeFingerprint(row);
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
        metadataJson: JSON.stringify(row.metadata)
      };
    });

    markInternalTransfers(transactions.filter((transaction) => !transaction.isDuplicate));

    const report: NormalizationReport = {
      id: crypto.randomUUID(),
      batchId: options.batch.id,
      createdAt: new Date().toISOString(),
      summary: createSummary(transactions),
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
