// Define the data model for transactions

export enum TransactionType {
    EXPENSE = 'expense',
    INCOME = 'income',
    INTERNAL = 'internal'
  }
  
export enum CategoryType {
    EXPENSE = 'expense',
    INCOME = 'income'
  }

  export enum AccountType {
    CHEQUING = 'chequing',
    SAVING = 'saving',
    CREDIT = 'credit',
    OTHER = 'other'
  }
  
  export enum ColorScheme {
    RED = 'red',
    BLUE = 'blue',
    GREEN = 'green',
    PURPLE = 'purple',
    ORANGE = 'orange',
    TEAL = 'teal',
    CUSTOM = 'custom',
    COLORBLIND_FRIENDLY = 'colorblind_friendly'
  }
  
  export interface Category {
    id: string;
    name: string;
    type: CategoryType;
  }

  export interface Account {
    id: string;
    name: string;
    type: AccountType;
    createdAt: string;
    color?: string;
    creditLimit?: number;
    isDefault?: boolean;
  }

  export type CategoryEmojiSettings = Record<string, string>;

  export class ColorPalette {
    static readonly lightCoral = '#e96767ff';
    static readonly darkGoldenrod = '#c08f1bff';
    static readonly lightSeaGreen = '#0eaaaaff';
    static readonly orchid = '#cb5ae2ff';
    static readonly burntPeach = '#e26b3cff';
    static readonly metallicGold = '#cba50bff';
    static readonly dodgerBlue = '#429efaff';
    static readonly cottonBloom = '#f04cd5ff';
    static readonly goldenChestnut = '#db7c2fff';
    static readonly limeMoss = '#7da72aff';
    static readonly softPeriwinkle = '#9288fcff';
    static readonly wildStrawberry = '#f25a8cff';
    static readonly bronze = '#c08635ff';
    static readonly jadeGreen = '#42ae42ff';
    static readonly brightLavender = '#b271f4ff';
    static readonly coolSteel = '#9e9e9eff';

    static readonly colors = [
      ColorPalette.lightCoral,
      ColorPalette.darkGoldenrod,
      ColorPalette.lightSeaGreen,
      ColorPalette.orchid,
      ColorPalette.burntPeach,
      ColorPalette.metallicGold,
      ColorPalette.dodgerBlue,
      ColorPalette.cottonBloom,
      ColorPalette.goldenChestnut,
      ColorPalette.limeMoss,
      ColorPalette.softPeriwinkle,
      ColorPalette.wildStrawberry,
      ColorPalette.bronze,
      ColorPalette.jadeGreen,
      ColorPalette.brightLavender,
      ColorPalette.coolSteel
    ] as const;
  }

  const CATEGORY_COLORS_BY_ID: Record<string, string> = {
    food: ColorPalette.metallicGold,
    groceries: ColorPalette.jadeGreen,
    transportation: ColorPalette.dodgerBlue,
    rent: ColorPalette.orchid,
    utilities: ColorPalette.lightSeaGreen,
    internet: ColorPalette.jadeGreen,
    entertainment: ColorPalette.brightLavender,
    shopping: ColorPalette.wildStrawberry,
    health: ColorPalette.limeMoss,
    education: ColorPalette.dodgerBlue,
    travel: ColorPalette.lightSeaGreen,
    fitness: ColorPalette.goldenChestnut,
    pets: ColorPalette.bronze,
    gifts: ColorPalette.cottonBloom,
    personal: ColorPalette.burntPeach,
    childcare: ColorPalette.lightCoral,
    subscriptions: ColorPalette.softPeriwinkle,
    insurance: ColorPalette.bronze,
    taxes: ColorPalette.lightCoral,
    internal: ColorPalette.coolSteel,
    other_expense: ColorPalette.coolSteel
  };

  const CATEGORY_COLORS_BY_NAME: Record<string, string> = {
    'food & dining': CATEGORY_COLORS_BY_ID.food,
    groceries: CATEGORY_COLORS_BY_ID.groceries,
    transportation: CATEGORY_COLORS_BY_ID.transportation,
    'rent/mortgage': CATEGORY_COLORS_BY_ID.rent,
    utilities: CATEGORY_COLORS_BY_ID.utilities,
    'internet & phone': CATEGORY_COLORS_BY_ID.internet,
    entertainment: CATEGORY_COLORS_BY_ID.entertainment,
    shopping: CATEGORY_COLORS_BY_ID.shopping,
    healthcare: CATEGORY_COLORS_BY_ID.health,
    education: CATEGORY_COLORS_BY_ID.education,
    travel: CATEGORY_COLORS_BY_ID.travel,
    fitness: CATEGORY_COLORS_BY_ID.fitness,
    pets: CATEGORY_COLORS_BY_ID.pets,
    'gifts & donations': CATEGORY_COLORS_BY_ID.gifts,
    'personal care': CATEGORY_COLORS_BY_ID.personal,
    childcare: CATEGORY_COLORS_BY_ID.childcare,
    subscriptions: CATEGORY_COLORS_BY_ID.subscriptions,
    insurance: CATEGORY_COLORS_BY_ID.insurance,
    taxes: CATEGORY_COLORS_BY_ID.taxes,
    internal: CATEGORY_COLORS_BY_ID.internal,
    'other expenses': CATEGORY_COLORS_BY_ID.other_expense
  };
  
  export interface Currency {
    code: string;  // ISO 4217 code (e.g. USD, EUR)
    name: string;  // Display name (e.g. US Dollar, Euro)
    symbol: string; // Currency symbol (e.g. $, €)
  }
  
export interface Transaction {
  id: string;
  date: string; // ISO date string
  time?: string; // HH:mm:ss local creation time
  type: TransactionType;
  amount: number;
    description: string;
    category: string; // Category ID
  account?: string; // type-name
  fromAccount?: string; // type-name
  toAccount?: string; // type-name
  notes?: string;
}

export const INTERNAL_CATEGORY_ID = 'internal';

export const DEFAULT_ACCOUNT_ID = 'default-account';
export const DEFAULT_ACCOUNT_NAME = 'Default';
export const DEFAULT_ACCOUNT: Account = {
  id: DEFAULT_ACCOUNT_ID,
  name: DEFAULT_ACCOUNT_NAME,
  type: AccountType.OTHER,
  createdAt: new Date(0).toISOString(),
  isDefault: true
};

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.CHEQUING]: 'Chequing',
  [AccountType.SAVING]: 'Savings',
  [AccountType.CREDIT]: 'Credit',
  [AccountType.OTHER]: 'Other'
};

const ACCOUNT_TYPE_EMOJIS: Record<AccountType, string> = {
  [AccountType.CHEQUING]: '🏦',
  [AccountType.SAVING]: '🏦',
  [AccountType.CREDIT]: '💳',
  [AccountType.OTHER]: '🏦'
};

let hasWarnedAboutIdFallback = false;
  
// Helper function to generate a unique ID
export function generateId(): string {
  const now = new Date();
  const datePart = formatDate(now).replace(/-/g, '');
  const timePart = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    : fallbackRandomIdPart();

  return `${datePart}-${timePart}-${randomPart}`;
}

export function normalizeAccountName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function formatAccountReference(type: AccountType, name: string): string {
  const normalizedName = normalizeAccountName(name).toLowerCase();
  return `${type}-${normalizedName}`;
}

export function parseAccountReference(account?: string | null): { type: AccountType; name: string; reference: string } {
  if (!account) {
    return {
      type: DEFAULT_ACCOUNT.type,
      name: DEFAULT_ACCOUNT.name,
      reference: formatAccountReference(DEFAULT_ACCOUNT.type, DEFAULT_ACCOUNT.name)
    };
  }

  const [rawType, ...nameParts] = account.split('-');
  const normalizedType = rawType?.toLowerCase();
  const type = normalizedType === AccountType.CREDIT
    ? AccountType.CREDIT
    : normalizedType === AccountType.SAVING
      ? AccountType.SAVING
      : normalizedType === AccountType.OTHER
        ? AccountType.OTHER
        : AccountType.CHEQUING;
  const rawName = normalizeAccountName(nameParts.join('-')) || ACCOUNT_TYPE_LABELS[type];
  const name = rawName
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    type,
    name,
    reference: formatAccountReference(type, rawName)
  };
}

export function getAccountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type];
}

export function getAccountEmoji(type: AccountType): string {
  return ACCOUNT_TYPE_EMOJIS[type];
}

export function normalizePaletteColor(color?: string | null): string | null {
  if (!color) {
    return null;
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color;
  }

  if (/^#[0-9a-f]{8}$/i.test(color)) {
    return color.slice(0, 7);
  }

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split('').map(char => `${char}${char}`).join('')}`;
  }

  return null;
}

export function getAccountColor(account: Account, accounts: Account[] = [account]): string {
  const storedColor = normalizePaletteColor(account.color);
  if (storedColor) {
    return storedColor;
  }

  const palette = ColorPalette.colors.map(color => color.slice(0, 7));
  const stableKey = account.id || formatAccountReference(account.type, account.name);
  const index = Array.from(stableKey).reduce((hash, character) => {
    return ((hash * 31) + character.charCodeAt(0)) >>> 0;
  }, 0) % palette.length;

  return palette[index];
}

export function getNextAccountColor(accounts: Account[]): string {
  const palette = ColorPalette.colors.map(color => color.slice(0, 7));
  const usedColors = new Set(accounts
    .map(account => normalizePaletteColor(account.color))
    .filter((color): color is string => !!color));

  const availableColor = palette.find(color => !usedColors.has(color));
  if (availableColor) {
    return availableColor;
  }

  return palette[accounts.length % palette.length];
}

export function compareAccounts(a: Account, b: Account): number {
  if (a.isDefault && !b.isDefault) {
    return -1;
  }

  if (!a.isDefault && b.isDefault) {
    return 1;
  }

  const order = {
    [AccountType.CHEQUING]: 1,
    [AccountType.CREDIT]: 2,
    [AccountType.SAVING]: 3,
    [AccountType.OTHER]: 4
  };

  const typeDifference = order[a.type] - order[b.type];
  if (typeDifference !== 0) {
    return typeDifference;
  }

  const createdAtDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return a.name.localeCompare(b.name);
}

function fallbackRandomIdPart(): string {
  if (!hasWarnedAboutIdFallback) {
    console.warn('Expensica: crypto.randomUUID() unavailable, using fallback transaction ID generation.');
    hasWarnedAboutIdFallback = true;
  }

  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

  // Helper function to format a time
  export function formatTime(date: Date = new Date()): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  function getTimeInSeconds(time: string | undefined): number | null {
    if (!time) {
      return null;
    }

    const match = time.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);

    if (hours > 23 || minutes > 59 || seconds > 59) {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  export function getTransactionTime(transaction: Transaction): string | null {
    if (getTimeInSeconds(transaction.time) !== null) {
      return transaction.time!;
    }

    const idTimeMatch = transaction.id.match(/^\d{8}-(\d{2})(\d{2})(\d{2})-/);
    if (!idTimeMatch) {
      return null;
    }

    const time = `${idTimeMatch[1]}:${idTimeMatch[2]}:${idTimeMatch[3]}`;
    return getTimeInSeconds(time) !== null ? time : null;
  }

  export function getTransactionDisplayTime(transaction: Transaction): string | null {
    return getTransactionTime(transaction)?.slice(0, 5) ?? null;
  }

  export function getCategoryTypeForTransactionType(type: TransactionType): CategoryType {
    return type === TransactionType.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE;
  }

  export function isInternalTransaction(transaction: Transaction): boolean {
    return transaction.type === TransactionType.INTERNAL;
  }

  export function getDefaultTransactionCategory(type: TransactionType, categories: Category[]): string {
    if (type === TransactionType.INTERNAL) {
      return INTERNAL_CATEGORY_ID;
    }

    const fallbackId = type === TransactionType.INCOME ? 'other_income' : 'other_expense';
    return categories.find(category => category.id === fallbackId)?.id
      || categories.find(category => category.type === getCategoryTypeForTransactionType(type))?.id
      || '';
  }

  export function sortTransactionsByDateTimeDesc<T extends Transaction>(transactions: T[]): T[] {
    return transactions
      .map((transaction, index) => ({ transaction, index }))
      .sort((a, b) => {
        const dateDiff = parseLocalDate(b.transaction.date).getTime() - parseLocalDate(a.transaction.date).getTime();
        if (dateDiff !== 0) {
          return dateDiff;
        }

        const aTime = getTimeInSeconds(getTransactionTime(a.transaction) || undefined);
        const bTime = getTimeInSeconds(getTransactionTime(b.transaction) || undefined);

        if (aTime !== null && bTime !== null && aTime !== bTime) {
          return bTime - aTime;
        }

        if (aTime !== null && bTime !== null) {
          return a.index - b.index;
        }

        return b.index - a.index;
      })
      .map(({ transaction }) => transaction);
  }

  export function getRunningBalanceByTransactionId(transactions: Transaction[]): Record<string, number> {
    let runningBalance = 0;

    return sortTransactionsByDateTimeDesc(transactions)
      .reverse()
      .reduce((balances, transaction) => {
        if (transaction.type === TransactionType.INCOME) {
          runningBalance += transaction.amount;
        } else if (transaction.type === TransactionType.EXPENSE) {
          runningBalance -= transaction.amount;
        }

        balances[transaction.id] = runningBalance;
        return balances;
      }, {} as Record<string, number>);
  }
  
  // Helper function to format a date
  export function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Parse a YYYY-MM-DD string as a local calendar date instead of UTC.
  export function parseLocalDate(dateString: string): Date {
    const [year, month, day] = dateString.substring(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  // Shared category colors for dashboard, chips, and calendar breakdowns.
  export function getCategoryColor(categoryNameOrId: string): string {
    const colorKey = categoryNameOrId.trim().toLowerCase();
    return CATEGORY_COLORS_BY_ID[colorKey]
      || CATEGORY_COLORS_BY_NAME[colorKey]
      || `hsl(${stringToHue(categoryNameOrId)}, 70%, 60%)`;
  }

  export function stringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    return ((hash % 360) + 360) % 360;
  }
  
  // Common world currencies
  export const COMMON_CURRENCIES: Currency[] = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
    { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
    { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
    { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$' },
    { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
    { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
    { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
    { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
    { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
    { code: 'THB', name: 'Thai Baht', symbol: '฿' },
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
    { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
    { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
    { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
    { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
    { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
    { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn' },
    { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
    { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr' },
    { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$' },
    { code: 'COP', name: 'Colombian Peso', symbol: 'COL$' },
    { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
    { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$' },
    { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
    { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
    { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
    { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
    { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
    { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼' },
    { code: 'OMR', name: 'Omani Rial', symbol: '﷼' },
    { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب' },
    { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا' },
    { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل' },
    { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.' },
    { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت' },
    { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج' },
    { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د' },
    { code: 'SYP', name: 'Syrian Pound', symbol: 'ل.س' },
    { code: 'YER', name: 'Yemeni Rial', symbol: '﷼' },
    { code: 'AFN', name: 'Afghan Afghani', symbol: '؋' },
    { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
    { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
    { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
    { code: 'LAK', name: 'Lao Kip', symbol: '₭' },
    { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
    { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
    { code: 'UZS', name: 'Uzbekistani Som', symbol: 'лв' },
    { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'ЅМ' },
    { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T' },
    { code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
    { code: 'AMD', name: 'Armenian Dram', symbol: '֏' },
    { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
    { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br' },
    { code: 'MDL', name: 'Moldovan Leu', symbol: 'L' },
    { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин.' },
    { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден' },
    { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM' },
    { code: 'ALL', name: 'Albanian Lek', symbol: 'L' },
    { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$' },
    { code: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$' },
    { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$' },
    { code: 'GYD', name: 'Guyanese Dollar', symbol: 'G$' },
    { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$' },
    { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$' },
    { code: 'BSD', name: 'Bahamian Dollar', symbol: 'B$' },
    { code: 'BMD', name: 'Bermudian Dollar', symbol: 'BD$' },
    { code: 'KYD', name: 'Cayman Islands Dollar', symbol: 'CI$' },
    { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$' },
    { code: 'SBD', name: 'Solomon Islands Dollar', symbol: 'SI$' },
    { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
    { code: 'WST', name: 'Samoan Tala', symbol: 'WS$' },
    { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT' },
    { code: 'XPF', name: 'CFP Franc', symbol: '₣' },
    { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$' },
    { code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
    { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
    { code: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲' },
    { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.' },
    { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
    { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
    { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.' },
    { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$' },
    { code: 'HTG', name: 'Haitian Gourde', symbol: 'G' },
    { code: 'CUP', name: 'Cuban Peso', symbol: '$MN' },
    { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ƒ' },
    { code: 'AWG', name: 'Aruban Florin', symbol: 'ƒ' },
    { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
    { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
    { code: 'XPF', name: 'CFP Franc', symbol: '₣' },
    { code: 'CDF', name: 'Congolese Franc', symbol: 'FC' },
    { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
    { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
    { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
    { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
    { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
    { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
    { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨' },
    { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf' },
    { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$' },
    { code: 'BND', name: 'Brunei Dollar', symbol: 'B$' },
    { code: 'KGS', name: 'Kyrgyzstani Som', symbol: 'с' },
    { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'ЅМ' },
    { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T' },
    { code: 'UZS', name: 'Uzbekistani Som', symbol: 'лв' },
    { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
    { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
    { code: 'LAK', name: 'Lao Kip', symbol: '₭' },
    { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
    { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
    { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
    { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.' },
    { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf' },
    { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
    { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨' },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
    { code: 'LSL', name: 'Lesotho Loti', symbol: 'L' },
    { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$' },
    { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L' },
    { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
    { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK' },
    { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: 'Z$' },
    { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
    { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu' },
    { code: 'CDF', name: 'Congolese Franc', symbol: 'FC' },
    { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj' },
    { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk' },
    { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
    { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
    { code: 'GNF', name: 'Guinean Franc', symbol: 'FG' },
    { code: 'KMF', name: 'Comorian Franc', symbol: 'CF' },
    { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$' },
    { code: 'LSL', name: 'Lesotho Loti', symbol: 'L' },
    { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
    { code: 'MRO', name: 'Mauritanian Ouguiya', symbol: 'UM' },
    { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT' },
    { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw' },
    { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.' },
    { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le' },
    { code: 'SOS', name: 'Somali Shilling', symbol: 'S' },
    { code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
    { code: 'STD', name: 'São Tomé and Príncipe Dobra', symbol: 'Db' },
    { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L' },
    { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت' },
    { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
    { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
    { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA' },
    { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
    { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' }
  ];
  
  // Helper function to get currency by code
  export function getCurrencyByCode(code: string): Currency | undefined {
    return COMMON_CURRENCIES.find(c => c.code === code);
  }
  
  // Updated format currency with symbol
  export function formatCurrency(amount: number, currencyCode: string = 'USD'): string {
    // If it's not a valid currency code, default to USD
    if (!COMMON_CURRENCIES.some(c => c.code === currencyCode)) {
      currencyCode = 'USD';
    }
    
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        currencyDisplay: 'symbol'
      }).format(amount);
    } catch (error) {
      // Fallback in case of invalid currency code
      console.error(`Invalid currency code: ${currencyCode}`, error);
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    }
  }
  
  // Helper function to get month name from date
  export function getMonthName(date: Date): string {
    return date.toLocaleString('default', { month: 'long' });
  }
  
  // Helper function to get year from date
  export function getYear(date: Date): number {
    return date.getFullYear();
  }
  
  // Helper function to get month and year string
  export function getMonthYearString(date: Date): string {
    return `${getMonthName(date)} ${getYear(date)}`;
  }
  
  // Default expense categories
  export const DEFAULT_EXPENSE_CATEGORIES: Category[] = [
    { id: 'food', name: 'Food & Dining', type: CategoryType.EXPENSE },
    { id: 'groceries', name: 'Groceries', type: CategoryType.EXPENSE },
    { id: 'transportation', name: 'Transportation', type: CategoryType.EXPENSE },
    { id: 'rent', name: 'Rent/Mortgage', type: CategoryType.EXPENSE },
    { id: 'utilities', name: 'Utilities', type: CategoryType.EXPENSE },
    { id: 'internet', name: 'Internet & Phone', type: CategoryType.EXPENSE },
    { id: 'entertainment', name: 'Entertainment', type: CategoryType.EXPENSE },
    { id: 'shopping', name: 'Shopping', type: CategoryType.EXPENSE },
    { id: 'health', name: 'Healthcare', type: CategoryType.EXPENSE },
    { id: 'education', name: 'Education', type: CategoryType.EXPENSE },
    { id: 'travel', name: 'Travel', type: CategoryType.EXPENSE },
    { id: 'fitness', name: 'Fitness', type: CategoryType.EXPENSE },
    { id: 'pets', name: 'Pets', type: CategoryType.EXPENSE },
    { id: 'gifts', name: 'Gifts & Donations', type: CategoryType.EXPENSE },
    { id: 'personal', name: 'Personal Care', type: CategoryType.EXPENSE },
    { id: 'childcare', name: 'Childcare', type: CategoryType.EXPENSE },
    { id: 'subscriptions', name: 'Subscriptions', type: CategoryType.EXPENSE },
    { id: 'insurance', name: 'Insurance', type: CategoryType.EXPENSE },
    { id: 'taxes', name: 'Taxes', type: CategoryType.EXPENSE },
    { id: 'internal', name: 'Internal', type: CategoryType.EXPENSE },
    { id: 'other_expense', name: 'Other Expenses', type: CategoryType.EXPENSE },
  ];
  
  // Default income categories
  export const DEFAULT_INCOME_CATEGORIES: Category[] = [
    { id: 'salary', name: 'Salary', type: CategoryType.INCOME },
    { id: 'freelance', name: 'Freelance', type: CategoryType.INCOME },
    { id: 'business', name: 'Business', type: CategoryType.INCOME },
    { id: 'investments', name: 'Investments', type: CategoryType.INCOME },
    { id: 'dividends', name: 'Dividends', type: CategoryType.INCOME },
    { id: 'rental', name: 'Rental Income', type: CategoryType.INCOME },
    { id: 'gifts_received', name: 'Gifts Received', type: CategoryType.INCOME },
    { id: 'tax_returns', name: 'Tax Returns', type: CategoryType.INCOME },
    { id: 'other_income', name: 'Other Income', type: CategoryType.INCOME },
  ];

  export const DEFAULT_CATEGORY_EMOJIS: CategoryEmojiSettings = {
    food: '🍔',
    groceries: '🥑',
    transportation: '🚗',
    rent: '🔑',
    utilities: '💡',
    internet: '📱',
    entertainment: '🎮',
    shopping: '🛍️',
    health: '💚',
    education: '🎓',
    travel: '✈️',
    fitness: '👟',
    pets: '🐶',
    gifts: '🎁',
    personal: '✂️',
    childcare: '🍼',
    subscriptions: '💳',
    insurance: '☂️',
    taxes: '📝',
    internal: '🔁',
    other_expense: '🤷‍♂️',
    salary: '💵',
    freelance: '💻',
    business: '🏢',
    investments: '📈',
    dividends: '💰',
    rental: '🏘️',
    gifts_received: '🎀',
    tax_returns: '📋',
    other_income: '💸'
  };
  
  export function getCommonCategoryEmojis(type: CategoryType): string[] {
    const emojis = DEFAULT_CATEGORIES
      .filter(category => category.type === type)
      .map(category => DEFAULT_CATEGORY_EMOJIS[category.id])
      .filter((emoji): emoji is string => !!emoji);

    return Array.from(new Set(emojis));
  }

  // Combine all default categories
  export const DEFAULT_CATEGORIES: Category[] = [
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...DEFAULT_INCOME_CATEGORIES
  ];
  
  export enum BudgetPeriod {
    MONTHLY = 'monthly',
    QUARTERLY = 'quarterly',
    YEARLY = 'yearly'
  }
  
  export interface Budget {
    id: string;
    categoryId: string;
    amount: number;
    period: BudgetPeriod;
    rollover: boolean;
    lastUpdated: string;
  }
  
  export interface BudgetData {
    budgets: Budget[];
    lastUpdated: string; // ISO timestamp
  }
  
  export const DEFAULT_BUDGET_DATA: BudgetData = {
    budgets: [],
    lastUpdated: new Date().toISOString()
  };
  
  // Helper function to calculate budget status
  export function calculateBudgetStatus(
    budget: Budget, 
    transactions: Transaction[], 
    currentDate: Date = new Date()
  ): { spent: number; remaining: number; percentage: number } {
    
    // Get start and end date for the budget period
    const { startDate, endDate } = getBudgetPeriodDates(budget.period, currentDate);
    
    // Filter transactions for this category in the current period
    const periodTransactions = transactions.filter(t => 
      t.category === budget.categoryId && 
      t.type === TransactionType.EXPENSE &&
      parseLocalDate(t.date) >= startDate &&
      parseLocalDate(t.date) <= endDate
    );
    
    // Calculate how much was spent
    const spent = periodTransactions.reduce((total, t) => total + t.amount, 0);
    
    // Calculate remaining budget and percentage
    const remaining = Math.max(0, budget.amount - spent);
    const percentage = budget.amount > 0 ? Math.min(100, (spent / budget.amount) * 100) : 0;
    
    return { spent, remaining, percentage };
  }
  
  // Get the date range for a budget period
  export function getBudgetPeriodDates(period: BudgetPeriod, currentDate: Date = new Date()): { startDate: Date, endDate: Date } {
    const now = new Date(currentDate);
    let startDate: Date;
    let endDate: Date;
    
    switch(period) {
      case BudgetPeriod.MONTHLY:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case BudgetPeriod.QUARTERLY:
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
        break;
      case BudgetPeriod.YEARLY:
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    return { startDate, endDate };
  }
  
  // Helper class for aggregating transaction data
  export class TransactionAggregator {
    static getTotalIncome(transactions: Transaction[]): number {
      return transactions
        .filter(t => t.type === TransactionType.INCOME)
        .reduce((sum, t) => sum + t.amount, 0);
    }
  
    static getTotalExpenses(transactions: Transaction[]): number {
      return transactions
        .filter(t => t.type === TransactionType.EXPENSE)
        .reduce((sum, t) => sum + t.amount, 0);
    }
  
    static getBalance(transactions: Transaction[]): number {
      return this.getTotalIncome(transactions) - this.getTotalExpenses(transactions);
    }
  
    static getExpensesByCategory(transactions: Transaction[], categories: Category[]): Record<string, number> {
      const expenses: Record<string, number> = {};
      transactions
        .filter(t => t.type === TransactionType.EXPENSE)
        .forEach(t => {
          const category = categories.find(c => c.id === t.category);
          const categoryName = category ? category.name : 'Unknown Category';
          if (!expenses[categoryName]) {
            expenses[categoryName] = 0;
          }
          expenses[categoryName] += t.amount;
        });
      return expenses;
    }
  
    static getTransactionsByDate(transactions: Transaction[]): Record<string, Transaction[]> {
      const byDate: Record<string, Transaction[]> = {};
      transactions.forEach(t => {
        const dateStr = t.date.substring(0, 10); // Get YYYY-MM-DD part
        if (!byDate[dateStr]) {
          byDate[dateStr] = [];
        }
        byDate[dateStr].push(t);
      });
      return byDate;
    }
  
    static getTransactionsByMonth(transactions: Transaction[]): Record<string, Transaction[]> {
      const byMonth: Record<string, Transaction[]> = {};
      transactions.forEach(t => {
        const monthStr = t.date.substring(0, 7); // Get YYYY-MM part
        if (!byMonth[monthStr]) {
          byMonth[monthStr] = [];
        }
        byMonth[monthStr].push(t);
      });
      return byMonth;
    }
  }
