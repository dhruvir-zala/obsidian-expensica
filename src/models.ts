// Define the data model for transactions

export enum TransactionType {
    EXPENSE = 'expense',
    INCOME = 'income'
  }
  
  export enum CategoryType {
    EXPENSE = 'expense',
    INCOME = 'income'
  }
  
  export interface Category {
    id: string;
    name: string;
    emoji: string;
    type: CategoryType;
  }
  
  export interface Currency {
    code: string;  // ISO 4217 code (e.g. USD, EUR)
    name: string;  // Display name (e.g. US Dollar, Euro)
    symbol: string; // Currency symbol (e.g. $, €)
  }
  
  export interface Transaction {
    id: string;
    date: string; // ISO date string
    type: TransactionType;
    amount: number;
    description: string;
    category: string; // Category ID
    notes?: string;
  }
  
  // Helper function to generate a unique ID
  export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }
  
  // Helper function to format a date
  export function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    { id: 'food', name: 'Food & Dining', emoji: '🍽️', type: CategoryType.EXPENSE },
    { id: 'groceries', name: 'Groceries', emoji: '🛒', type: CategoryType.EXPENSE },
    { id: 'transportation', name: 'Transportation', emoji: '🚗', type: CategoryType.EXPENSE },
    { id: 'rent', name: 'Rent/Mortgage', emoji: '🏠', type: CategoryType.EXPENSE },
    { id: 'utilities', name: 'Utilities', emoji: '💡', type: CategoryType.EXPENSE },
    { id: 'internet', name: 'Internet & Phone', emoji: '📱', type: CategoryType.EXPENSE },
    { id: 'entertainment', name: 'Entertainment', emoji: '🎬', type: CategoryType.EXPENSE },
    { id: 'shopping', name: 'Shopping', emoji: '🛍️', type: CategoryType.EXPENSE },
    { id: 'health', name: 'Healthcare', emoji: '🏥', type: CategoryType.EXPENSE },
    { id: 'education', name: 'Education', emoji: '📚', type: CategoryType.EXPENSE },
    { id: 'travel', name: 'Travel', emoji: '✈️', type: CategoryType.EXPENSE },
    { id: 'fitness', name: 'Fitness', emoji: '🏋️', type: CategoryType.EXPENSE },
    { id: 'pets', name: 'Pets', emoji: '🐾', type: CategoryType.EXPENSE },
    { id: 'gifts', name: 'Gifts & Donations', emoji: '🎁', type: CategoryType.EXPENSE },
    { id: 'personal', name: 'Personal Care', emoji: '💇', type: CategoryType.EXPENSE },
    { id: 'childcare', name: 'Childcare', emoji: '👶', type: CategoryType.EXPENSE },
    { id: 'subscriptions', name: 'Subscriptions', emoji: '📺', type: CategoryType.EXPENSE },
    { id: 'insurance', name: 'Insurance', emoji: '🔒', type: CategoryType.EXPENSE },
    { id: 'taxes', name: 'Taxes', emoji: '📝', type: CategoryType.EXPENSE },
    { id: 'other_expense', name: 'Other Expenses', emoji: '💼', type: CategoryType.EXPENSE },
  ];
  
  // Default income categories
  export const DEFAULT_INCOME_CATEGORIES: Category[] = [
    { id: 'salary', name: 'Salary', emoji: '💰', type: CategoryType.INCOME },
    { id: 'freelance', name: 'Freelance', emoji: '💻', type: CategoryType.INCOME },
    { id: 'business', name: 'Business', emoji: '🏢', type: CategoryType.INCOME },
    { id: 'investments', name: 'Investments', emoji: '📈', type: CategoryType.INCOME },
    { id: 'dividends', name: 'Dividends', emoji: '💵', type: CategoryType.INCOME },
    { id: 'rental', name: 'Rental Income', emoji: '🏘️', type: CategoryType.INCOME },
    { id: 'gifts_received', name: 'Gifts Received', emoji: '🎀', type: CategoryType.INCOME },
    { id: 'tax_returns', name: 'Tax Returns', emoji: '📋', type: CategoryType.INCOME },
    { id: 'other_income', name: 'Other Income', emoji: '💸', type: CategoryType.INCOME },
  ];
  
  // Combine all default categories
  export const DEFAULT_CATEGORIES: Category[] = [
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...DEFAULT_INCOME_CATEGORIES
  ];
  
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
          const categoryName = category ? `${category.emoji} ${category.name}` : '❓ Unknown Category';
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