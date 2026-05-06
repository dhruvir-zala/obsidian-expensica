// Define the data model for transactions
export var TransactionType;
(function (TransactionType) {
    TransactionType["EXPENSE"] = "expense";
    TransactionType["INCOME"] = "income";
    TransactionType["INTERNAL"] = "internal";
})(TransactionType || (TransactionType = {}));
export var CategoryType;
(function (CategoryType) {
    CategoryType["EXPENSE"] = "expense";
    CategoryType["INCOME"] = "income";
})(CategoryType || (CategoryType = {}));
export var AccountType;
(function (AccountType) {
    AccountType["CHEQUING"] = "chequing";
    AccountType["SAVING"] = "saving";
    AccountType["CREDIT"] = "credit";
    AccountType["OTHER"] = "other";
})(AccountType || (AccountType = {}));
export var ColorScheme;
(function (ColorScheme) {
    ColorScheme["RED"] = "red";
    ColorScheme["BLUE"] = "blue";
    ColorScheme["GREEN"] = "green";
    ColorScheme["PURPLE"] = "purple";
    ColorScheme["ORANGE"] = "orange";
    ColorScheme["TEAL"] = "teal";
    ColorScheme["CUSTOM"] = "custom";
    ColorScheme["COLORBLIND_FRIENDLY"] = "colorblind_friendly";
})(ColorScheme || (ColorScheme = {}));
export class ColorPalette {
}
ColorPalette.lightCoral = '#e96767ff';
ColorPalette.darkGoldenrod = '#c08f1bff';
ColorPalette.lightSeaGreen = '#0eaaaaff';
ColorPalette.orchid = '#cb5ae2ff';
ColorPalette.burntPeach = '#e26b3cff';
ColorPalette.metallicGold = '#cba50bff';
ColorPalette.dodgerBlue = '#429efaff';
ColorPalette.cottonBloom = '#f04cd5ff';
ColorPalette.goldenChestnut = '#db7c2fff';
ColorPalette.limeMoss = '#7da72aff';
ColorPalette.softPeriwinkle = '#9288fcff';
ColorPalette.wildStrawberry = '#f25a8cff';
ColorPalette.bronze = '#c08635ff';
ColorPalette.jadeGreen = '#42ae42ff';
ColorPalette.brightLavender = '#b271f4ff';
ColorPalette.coolSteel = '#9e9e9eff';
ColorPalette.colors = [
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
];
const CATEGORY_COLORS_BY_ID = {
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
const CATEGORY_COLORS_BY_NAME = {
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
export const INTERNAL_CATEGORY_ID = 'internal';
export const DEFAULT_ACCOUNT_ID = 'default-account';
export const DEFAULT_ACCOUNT_NAME = 'Default';
export const DEFAULT_ACCOUNT = {
    id: DEFAULT_ACCOUNT_ID,
    name: DEFAULT_ACCOUNT_NAME,
    type: AccountType.OTHER,
    createdAt: new Date(0).toISOString(),
    isDefault: true
};
const ACCOUNT_TYPE_LABELS = {
    [AccountType.CHEQUING]: 'Chequing',
    [AccountType.SAVING]: 'Savings',
    [AccountType.CREDIT]: 'Credit',
    [AccountType.OTHER]: 'Other'
};
const ACCOUNT_TYPE_EMOJIS = {
    [AccountType.CHEQUING]: '🏦',
    [AccountType.SAVING]: '🏦',
    [AccountType.CREDIT]: '💳',
    [AccountType.OTHER]: '🏦'
};
let hasWarnedAboutIdFallback = false;
// Helper function to generate a unique ID
export function generateId() {
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
export function normalizeAccountName(name) {
    return name.trim().replace(/\s+/g, ' ');
}
export function formatAccountReference(type, name) {
    const normalizedName = normalizeAccountName(name).toLowerCase();
    return `${type}-${normalizedName}`;
}
export function parseAccountReference(account) {
    if (!account) {
        return {
            type: DEFAULT_ACCOUNT.type,
            name: DEFAULT_ACCOUNT.name,
            reference: formatAccountReference(DEFAULT_ACCOUNT.type, DEFAULT_ACCOUNT.name)
        };
    }
    const [rawType, ...nameParts] = account.split('-');
    const normalizedType = rawType === null || rawType === void 0 ? void 0 : rawType.toLowerCase();
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
export function getAccountTypeLabel(type) {
    return ACCOUNT_TYPE_LABELS[type];
}
export function getAccountEmoji(type) {
    return ACCOUNT_TYPE_EMOJIS[type];
}
export function normalizePaletteColor(color) {
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
export function getAccountColor(account, accounts = [account]) {
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
export function getNextAccountColor(accounts) {
    const palette = ColorPalette.colors.map(color => color.slice(0, 7));
    const usedColors = new Set(accounts
        .map(account => normalizePaletteColor(account.color))
        .filter((color) => !!color));
    const availableColor = palette.find(color => !usedColors.has(color));
    if (availableColor) {
        return availableColor;
    }
    return palette[accounts.length % palette.length];
}
export function compareAccounts(a, b) {
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
function fallbackRandomIdPart() {
    if (!hasWarnedAboutIdFallback) {
        console.warn('Expensica: crypto.randomUUID() unavailable, using fallback transaction ID generation.');
        hasWarnedAboutIdFallback = true;
    }
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}
// Helper function to format a time
export function formatTime(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}
function getTimeInSeconds(time) {
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
export function getTransactionTime(transaction) {
    if (getTimeInSeconds(transaction.time) !== null) {
        return transaction.time;
    }
    const idTimeMatch = transaction.id.match(/^\d{8}-(\d{2})(\d{2})(\d{2})-/);
    if (!idTimeMatch) {
        return null;
    }
    const time = `${idTimeMatch[1]}:${idTimeMatch[2]}:${idTimeMatch[3]}`;
    return getTimeInSeconds(time) !== null ? time : null;
}
export function getTransactionDisplayTime(transaction) {
    var _a, _b;
    return (_b = (_a = getTransactionTime(transaction)) === null || _a === void 0 ? void 0 : _a.slice(0, 5)) !== null && _b !== void 0 ? _b : null;
}
export function getCategoryTypeForTransactionType(type) {
    return type === TransactionType.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE;
}
export function isInternalTransaction(transaction) {
    return transaction.type === TransactionType.INTERNAL;
}
export function getDefaultTransactionCategory(type, categories) {
    var _a, _b;
    if (type === TransactionType.INTERNAL) {
        return INTERNAL_CATEGORY_ID;
    }
    const fallbackId = type === TransactionType.INCOME ? 'other_income' : 'other_expense';
    return ((_a = categories.find(category => category.id === fallbackId)) === null || _a === void 0 ? void 0 : _a.id)
        || ((_b = categories.find(category => category.type === getCategoryTypeForTransactionType(type))) === null || _b === void 0 ? void 0 : _b.id)
        || '';
}
export function sortTransactionsByDateTimeDesc(transactions) {
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
export function getRunningBalanceByTransactionId(transactions) {
    let runningBalance = 0;
    return sortTransactionsByDateTimeDesc(transactions)
        .reverse()
        .reduce((balances, transaction) => {
        if (transaction.type === TransactionType.INCOME) {
            runningBalance += transaction.amount;
        }
        else if (transaction.type === TransactionType.EXPENSE) {
            runningBalance -= transaction.amount;
        }
        balances[transaction.id] = runningBalance;
        return balances;
    }, {});
}
// Helper function to format a date
export function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
// Parse a YYYY-MM-DD string as a local calendar date instead of UTC.
export function parseLocalDate(dateString) {
    const [year, month, day] = dateString.substring(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
}
// Shared category colors for dashboard, chips, and calendar breakdowns.
export function getCategoryColor(categoryNameOrId) {
    const colorKey = categoryNameOrId.trim().toLowerCase();
    return CATEGORY_COLORS_BY_ID[colorKey]
        || CATEGORY_COLORS_BY_NAME[colorKey]
        || `hsl(${stringToHue(categoryNameOrId)}, 70%, 60%)`;
}
export function stringToHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ((hash % 360) + 360) % 360;
}
// Common world currencies
export const COMMON_CURRENCIES = [
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
export function getCurrencyByCode(code) {
    return COMMON_CURRENCIES.find(c => c.code === code);
}
// Updated format currency with symbol
export function formatCurrency(amount, currencyCode = 'USD') {
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
    }
    catch (error) {
        // Fallback in case of invalid currency code
        console.error(`Invalid currency code: ${currencyCode}`, error);
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }
}
// Helper function to get month name from date
export function getMonthName(date) {
    return date.toLocaleString('default', { month: 'long' });
}
// Helper function to get year from date
export function getYear(date) {
    return date.getFullYear();
}
// Helper function to get month and year string
export function getMonthYearString(date) {
    return `${getMonthName(date)} ${getYear(date)}`;
}
// Default expense categories
export const DEFAULT_EXPENSE_CATEGORIES = [
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
export const DEFAULT_INCOME_CATEGORIES = [
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
export const DEFAULT_CATEGORY_EMOJIS = {
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
export function getCommonCategoryEmojis(type) {
    const emojis = DEFAULT_CATEGORIES
        .filter(category => category.type === type)
        .map(category => DEFAULT_CATEGORY_EMOJIS[category.id])
        .filter((emoji) => !!emoji);
    return Array.from(new Set(emojis));
}
// Combine all default categories
export const DEFAULT_CATEGORIES = [
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...DEFAULT_INCOME_CATEGORIES
];
export var BudgetPeriod;
(function (BudgetPeriod) {
    BudgetPeriod["MONTHLY"] = "monthly";
    BudgetPeriod["QUARTERLY"] = "quarterly";
    BudgetPeriod["YEARLY"] = "yearly";
})(BudgetPeriod || (BudgetPeriod = {}));
export const DEFAULT_BUDGET_DATA = {
    budgets: [],
    lastUpdated: new Date().toISOString()
};
// Helper function to calculate budget status
export function calculateBudgetStatus(budget, transactions, currentDate = new Date()) {
    // Get start and end date for the budget period
    const { startDate, endDate } = getBudgetPeriodDates(budget.period, currentDate);
    // Filter transactions for this category in the current period
    const periodTransactions = transactions.filter(t => t.category === budget.categoryId &&
        t.type === TransactionType.EXPENSE &&
        parseLocalDate(t.date) >= startDate &&
        parseLocalDate(t.date) <= endDate);
    // Calculate how much was spent
    const spent = periodTransactions.reduce((total, t) => total + t.amount, 0);
    // Calculate remaining budget and percentage
    const remaining = Math.max(0, budget.amount - spent);
    const percentage = budget.amount > 0 ? Math.min(100, (spent / budget.amount) * 100) : 0;
    return { spent, remaining, percentage };
}
// Get the date range for a budget period
export function getBudgetPeriodDates(period, currentDate = new Date()) {
    const now = new Date(currentDate);
    let startDate;
    let endDate;
    switch (period) {
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
    static getTotalIncome(transactions) {
        return transactions
            .filter(t => t.type === TransactionType.INCOME)
            .reduce((sum, t) => sum + t.amount, 0);
    }
    static getTotalExpenses(transactions) {
        return transactions
            .filter(t => t.type === TransactionType.EXPENSE)
            .reduce((sum, t) => sum + t.amount, 0);
    }
    static getBalance(transactions) {
        return this.getTotalIncome(transactions) - this.getTotalExpenses(transactions);
    }
    static getExpensesByCategory(transactions, categories) {
        const expenses = {};
        transactions
            .filter(t => t.type === TransactionType.EXPENSE)
            .forEach(t => {
            const category = categories.find(c => c.id === t.category);
            const categoryName = category ? category.name : 'Other Expenses';
            if (!expenses[categoryName]) {
                expenses[categoryName] = 0;
            }
            expenses[categoryName] += t.amount;
        });
        return expenses;
    }
    static getTransactionsByDate(transactions) {
        const byDate = {};
        transactions.forEach(t => {
            const dateStr = t.date.substring(0, 10); // Get YYYY-MM-DD part
            if (!byDate[dateStr]) {
                byDate[dateStr] = [];
            }
            byDate[dateStr].push(t);
        });
        return byDate;
    }
    static getTransactionsByMonth(transactions) {
        const byMonth = {};
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibW9kZWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLHlDQUF5QztBQUV6QyxNQUFNLENBQU4sSUFBWSxlQUlUO0FBSkgsV0FBWSxlQUFlO0lBQ3ZCLHNDQUFtQixDQUFBO0lBQ25CLG9DQUFpQixDQUFBO0lBQ2pCLHdDQUFxQixDQUFBO0FBQ3ZCLENBQUMsRUFKUyxlQUFlLEtBQWYsZUFBZSxRQUl4QjtBQUVILE1BQU0sQ0FBTixJQUFZLFlBR1Q7QUFISCxXQUFZLFlBQVk7SUFDcEIsbUNBQW1CLENBQUE7SUFDbkIsaUNBQWlCLENBQUE7QUFDbkIsQ0FBQyxFQUhTLFlBQVksS0FBWixZQUFZLFFBR3JCO0FBRUQsTUFBTSxDQUFOLElBQVksV0FLWDtBQUxELFdBQVksV0FBVztJQUNyQixvQ0FBcUIsQ0FBQTtJQUNyQixnQ0FBaUIsQ0FBQTtJQUNqQixnQ0FBaUIsQ0FBQTtJQUNqQiw4QkFBZSxDQUFBO0FBQ2pCLENBQUMsRUFMVyxXQUFXLEtBQVgsV0FBVyxRQUt0QjtBQUVELE1BQU0sQ0FBTixJQUFZLFdBU1g7QUFURCxXQUFZLFdBQVc7SUFDckIsMEJBQVcsQ0FBQTtJQUNYLDRCQUFhLENBQUE7SUFDYiw4QkFBZSxDQUFBO0lBQ2YsZ0NBQWlCLENBQUE7SUFDakIsZ0NBQWlCLENBQUE7SUFDakIsNEJBQWEsQ0FBQTtJQUNiLGdDQUFpQixDQUFBO0lBQ2pCLDBEQUEyQyxDQUFBO0FBQzdDLENBQUMsRUFUVyxXQUFXLEtBQVgsV0FBVyxRQVN0QjtBQW9CRCxNQUFNLE9BQU8sWUFBWTs7QUFDUCx1QkFBVSxHQUFHLFdBQVcsQ0FBQztBQUN6QiwwQkFBYSxHQUFHLFdBQVcsQ0FBQztBQUM1QiwwQkFBYSxHQUFHLFdBQVcsQ0FBQztBQUM1QixtQkFBTSxHQUFHLFdBQVcsQ0FBQztBQUNyQix1QkFBVSxHQUFHLFdBQVcsQ0FBQztBQUN6Qix5QkFBWSxHQUFHLFdBQVcsQ0FBQztBQUMz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QUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsc0JBQXNCO1lBQy9ELElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ3BCLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUM7YUFDdEI7WUFDRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzFCLENBQUMsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sQ0FBQyxzQkFBc0IsQ0FBQyxZQUEyQjtRQUN2RCxNQUFNLE9BQU8sR0FBa0MsRUFBRSxDQUFDO1FBQ2xELFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDdkIsTUFBTSxRQUFRLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CO1lBQzVELElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEVBQUU7Z0JBQ3RCLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFLENBQUM7YUFDeEI7WUFDRCxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzVCLENBQUMsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gRGVmaW5lIHRoZSBkYXRhIG1vZGVsIGZvciB0cmFuc2FjdGlvbnNcblxuZXhwb3J0IGVudW0gVHJhbnNhY3Rpb25UeXBlIHtcbiAgICBFWFBFTlNFID0gJ2V4cGVuc2UnLFxuICAgIElOQ09NRSA9ICdpbmNvbWUnLFxuICAgIElOVEVSTkFMID0gJ2ludGVybmFsJ1xuICB9XG4gIFxuZXhwb3J0IGVudW0gQ2F0ZWdvcnlUeXBlIHtcbiAgICBFWFBFTlNFID0gJ2V4cGVuc2UnLFxuICAgIElOQ09NRSA9ICdpbmNvbWUnXG4gIH1cblxuICBleHBvcnQgZW51bSBBY2NvdW50VHlwZSB7XG4gICAgQ0hFUVVJTkcgPSAnY2hlcXVpbmcnLFxuICAgIFNBVklORyA9ICdzYXZpbmcnLFxuICAgIENSRURJVCA9ICdjcmVkaXQnLFxuICAgIE9USEVSID0gJ290aGVyJ1xuICB9XG4gIFxuICBleHBvcnQgZW51bSBDb2xvclNjaGVtZSB7XG4gICAgUkVEID0gJ3JlZCcsXG4gICAgQkxVRSA9ICdibHVlJyxcbiAgICBHUkVFTiA9ICdncmVlbicsXG4gICAgUFVSUExFID0gJ3B1cnBsZScsXG4gICAgT1JBTkdFID0gJ29yYW5nZScsXG4gICAgVEVBTCA9ICd0ZWFsJyxcbiAgICBDVVNUT00gPSAnY3VzdG9tJyxcbiAgICBDT0xPUkJMSU5EX0ZSSUVORExZID0gJ2NvbG9yYmxpbmRfZnJpZW5kbHknXG4gIH1cbiAgXG4gIGV4cG9ydCBpbnRlcmZhY2UgQ2F0ZWdvcnkge1xuICAgIGlkOiBzdHJpbmc7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIHR5cGU6IENhdGVnb3J5VHlwZTtcbiAgfVxuXG4gIGV4cG9ydCBpbnRlcmZhY2UgQWNjb3VudCB7XG4gICAgaWQ6IHN0cmluZztcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgdHlwZTogQWNjb3VudFR5cGU7XG4gICAgY3JlYXRlZEF0OiBzdHJpbmc7XG4gICAgY29sb3I/OiBzdHJpbmc7XG4gICAgY3JlZGl0TGltaXQ/OiBudW1iZXI7XG4gICAgaXNEZWZhdWx0PzogYm9vbGVhbjtcbiAgfVxuXG4gIGV4cG9ydCB0eXBlIENhdGVnb3J5RW1vamlTZXR0aW5ncyA9IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgZXhwb3J0IGNsYXNzIENvbG9yUGFsZXR0ZSB7XG4gICAgc3RhdGljIHJlYWRvbmx5IGxpZ2h0Q29yYWwgPSAnI2U5Njc2N2ZmJztcbiAgICBzdGF0aWMgcmVhZG9ubHkgZGFya0dvbGRlbnJvZCA9ICcjYzA4ZjFiZmYnO1xuICAgIHN0YXRpYyByZWFkb25seSBsaWdodFNlYUdyZWVuID0gJyMwZWFhYWFmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IG9yY2hpZCA9ICcjY2I1YWUyZmYnO1xuICAgIHN0YXRpYyByZWFkb25seSBidXJudFBlYWNoID0gJyNlMjZiM2NmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IG1ldGFsbGljR29sZCA9ICcjY2JhNTBiZmYnO1xuICAgIHN0YXRpYyByZWFkb25seSBkb2RnZXJCbHVlID0gJyM0MjllZmFmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IGNvdHRvbkJsb29tID0gJyNmMDRjZDVmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IGdvbGRlbkNoZXN0bnV0ID0gJyNkYjdjMmZmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IGxpbWVNb3NzID0gJyM3ZGE3MmFmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IHNvZnRQZXJpd2lua2xlID0gJyM5Mjg4ZmNmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IHdpbGRTdHJhd2JlcnJ5ID0gJyNmMjVhOGNmZic7XG4gICAgc3RhdGljIHJlYWRvbmx5IGJyb256ZSA9ICcjYzA4NjM1ZmYnO1xuICAgIHN0YXRpYyByZWFkb25seSBqYWRlR3JlZW4gPSAnIzQyYWU0MmZmJztcbiAgICBzdGF0aWMgcmVhZG9ubHkgYnJpZ2h0TGF2ZW5kZXIgPSAnI2IyNzFmNGZmJztcbiAgICBzdGF0aWMgcmVhZG9ubHkgY29vbFN0ZWVsID0gJyM5ZTllOWVmZic7XG5cbiAgICBzdGF0aWMgcmVhZG9ubHkgY29sb3JzID0gW1xuICAgICAgQ29sb3JQYWxldHRlLmxpZ2h0Q29yYWwsXG4gICAgICBDb2xvclBhbGV0dGUuZGFya0dvbGRlbnJvZCxcbiAgICAgIENvbG9yUGFsZXR0ZS5saWdodFNlYUdyZWVuLFxuICAgICAgQ29sb3JQYWxldHRlLm9yY2hpZCxcbiAgICAgIENvbG9yUGFsZXR0ZS5idXJudFBlYWNoLFxuICAgICAgQ29sb3JQYWxldHRlLm1ldGFsbGljR29sZCxcbiAgICAgIENvbG9yUGFsZXR0ZS5kb2RnZXJCbHVlLFxuICAgICAgQ29sb3JQYWxldHRlLmNvdHRvbkJsb29tLFxuICAgICAgQ29sb3JQYWxldHRlLmdvbGRlbkNoZXN0bnV0LFxuICAgICAgQ29sb3JQYWxldHRlLmxpbWVNb3NzLFxuICAgICAgQ29sb3JQYWxldHRlLnNvZnRQZXJpd2lua2xlLFxuICAgICAgQ29sb3JQYWxldHRlLndpbGRTdHJhd2JlcnJ5LFxuICAgICAgQ29sb3JQYWxldHRlLmJyb256ZSxcbiAgICAgIENvbG9yUGFsZXR0ZS5qYWRlR3JlZW4sXG4gICAgICBDb2xvclBhbGV0dGUuYnJpZ2h0TGF2ZW5kZXIsXG4gICAgICBDb2xvclBhbGV0dGUuY29vbFN0ZWVsXG4gICAgXSBhcyBjb25zdDtcbiAgfVxuXG4gIGNvbnN0IENBVEVHT1JZX0NPTE9SU19CWV9JRDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICBmb29kOiBDb2xvclBhbGV0dGUubWV0YWxsaWNHb2xkLFxuICAgIGdyb2NlcmllczogQ29sb3JQYWxldHRlLmphZGVHcmVlbixcbiAgICB0cmFuc3BvcnRhdGlvbjogQ29sb3JQYWxldHRlLmRvZGdlckJsdWUsXG4gICAgcmVudDogQ29sb3JQYWxldHRlLm9yY2hpZCxcbiAgICB1dGlsaXRpZXM6IENvbG9yUGFsZXR0ZS5saWdodFNlYUdyZWVuLFxuICAgIGludGVybmV0OiBDb2xvclBhbGV0dGUuamFkZUdyZWVuLFxuICAgIGVudGVydGFpbm1lbnQ6IENvbG9yUGFsZXR0ZS5icmlnaHRMYXZlbmRlcixcbiAgICBzaG9wcGluZzogQ29sb3JQYWxldHRlLndpbGRTdHJhd2JlcnJ5LFxuICAgIGhlYWx0aDogQ29sb3JQYWxldHRlLmxpbWVNb3NzLFxuICAgIGVkdWNhdGlvbjogQ29sb3JQYWxldHRlLmRvZGdlckJsdWUsXG4gICAgdHJhdmVsOiBDb2xvclBhbGV0dGUubGlnaHRTZWFHcmVlbixcbiAgICBmaXRuZXNzOiBDb2xvclBhbGV0dGUuZ29sZGVuQ2hlc3RudXQsXG4gICAgcGV0czogQ29sb3JQYWxldHRlLmJyb256ZSxcbiAgICBnaWZ0czogQ29sb3JQYWxldHRlLmNvdHRvbkJsb29tLFxuICAgIHBlcnNvbmFsOiBDb2xvclBhbGV0dGUuYnVybnRQZWFjaCxcbiAgICBjaGlsZGNhcmU6IENvbG9yUGFsZXR0ZS5saWdodENvcmFsLFxuICAgIHN1YnNjcmlwdGlvbnM6IENvbG9yUGFsZXR0ZS5zb2Z0UGVyaXdpbmtsZSxcbiAgICBpbnN1cmFuY2U6IENvbG9yUGFsZXR0ZS5icm9uemUsXG4gICAgdGF4ZXM6IENvbG9yUGFsZXR0ZS5saWdodENvcmFsLFxuICAgIGludGVybmFsOiBDb2xvclBhbGV0dGUuY29vbFN0ZWVsLFxuICAgIG90aGVyX2V4cGVuc2U6IENvbG9yUGFsZXR0ZS5jb29sU3RlZWxcbiAgfTtcblxuICBjb25zdCBDQVRFR09SWV9DT0xPUlNfQllfTkFNRTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAnZm9vZCAmIGRpbmluZyc6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5mb29kLFxuICAgIGdyb2NlcmllczogQ0FURUdPUllfQ09MT1JTX0JZX0lELmdyb2NlcmllcyxcbiAgICB0cmFuc3BvcnRhdGlvbjogQ0FURUdPUllfQ09MT1JTX0JZX0lELnRyYW5zcG9ydGF0aW9uLFxuICAgICdyZW50L21vcnRnYWdlJzogQ0FURUdPUllfQ09MT1JTX0JZX0lELnJlbnQsXG4gICAgdXRpbGl0aWVzOiBDQVRFR09SWV9DT0xPUlNfQllfSUQudXRpbGl0aWVzLFxuICAgICdpbnRlcm5ldCAmIHBob25lJzogQ0FURUdPUllfQ09MT1JTX0JZX0lELmludGVybmV0LFxuICAgIGVudGVydGFpbm1lbnQ6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5lbnRlcnRhaW5tZW50LFxuICAgIHNob3BwaW5nOiBDQVRFR09SWV9DT0xPUlNfQllfSUQuc2hvcHBpbmcsXG4gICAgaGVhbHRoY2FyZTogQ0FURUdPUllfQ09MT1JTX0JZX0lELmhlYWx0aCxcbiAgICBlZHVjYXRpb246IENBVEVHT1JZX0NPTE9SU19CWV9JRC5lZHVjYXRpb24sXG4gICAgdHJhdmVsOiBDQVRFR09SWV9DT0xPUlNfQllfSUQudHJhdmVsLFxuICAgIGZpdG5lc3M6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5maXRuZXNzLFxuICAgIHBldHM6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5wZXRzLFxuICAgICdnaWZ0cyAmIGRvbmF0aW9ucyc6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5naWZ0cyxcbiAgICAncGVyc29uYWwgY2FyZSc6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5wZXJzb25hbCxcbiAgICBjaGlsZGNhcmU6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5jaGlsZGNhcmUsXG4gICAgc3Vic2NyaXB0aW9uczogQ0FURUdPUllfQ09MT1JTX0JZX0lELnN1YnNjcmlwdGlvbnMsXG4gICAgaW5zdXJhbmNlOiBDQVRFR09SWV9DT0xPUlNfQllfSUQuaW5zdXJhbmNlLFxuICAgIHRheGVzOiBDQVRFR09SWV9DT0xPUlNfQllfSUQudGF4ZXMsXG4gICAgaW50ZXJuYWw6IENBVEVHT1JZX0NPTE9SU19CWV9JRC5pbnRlcm5hbCxcbiAgICAnb3RoZXIgZXhwZW5zZXMnOiBDQVRFR09SWV9DT0xPUlNfQllfSUQub3RoZXJfZXhwZW5zZVxuICB9O1xuICBcbiAgZXhwb3J0IGludGVyZmFjZSBDdXJyZW5jeSB7XG4gICAgY29kZTogc3RyaW5nOyAgLy8gSVNPIDQyMTcgY29kZSAoZS5nLiBVU0QsIEVVUilcbiAgICBuYW1lOiBzdHJpbmc7ICAvLyBEaXNwbGF5IG5hbWUgKGUuZy4gVVMgRG9sbGFyLCBFdXJvKVxuICAgIHN5bWJvbDogc3RyaW5nOyAvLyBDdXJyZW5jeSBzeW1ib2wgKGUuZy4gJCwg4oKsKVxuICB9XG4gIFxuZXhwb3J0IGludGVyZmFjZSBUcmFuc2FjdGlvbiB7XG4gIGlkOiBzdHJpbmc7XG4gIGRhdGU6IHN0cmluZzsgLy8gSVNPIGRhdGUgc3RyaW5nXG4gIHRpbWU/OiBzdHJpbmc7IC8vIEhIOm1tOnNzIGxvY2FsIGNyZWF0aW9uIHRpbWVcbiAgdHlwZTogVHJhbnNhY3Rpb25UeXBlO1xuICBhbW91bnQ6IG51bWJlcjtcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAgIGNhdGVnb3J5OiBzdHJpbmc7IC8vIENhdGVnb3J5IElEXG4gIGFjY291bnQ/OiBzdHJpbmc7IC8vIHR5cGUtbmFtZVxuICBmcm9tQWNjb3VudD86IHN0cmluZzsgLy8gdHlwZS1uYW1lXG4gIHRvQWNjb3VudD86IHN0cmluZzsgLy8gdHlwZS1uYW1lXG4gIG5vdGVzPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgSU5URVJOQUxfQ0FURUdPUllfSUQgPSAnaW50ZXJuYWwnO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9BQ0NPVU5UX0lEID0gJ2RlZmF1bHQtYWNjb3VudCc7XG5leHBvcnQgY29uc3QgREVGQVVMVF9BQ0NPVU5UX05BTUUgPSAnRGVmYXVsdCc7XG5leHBvcnQgY29uc3QgREVGQVVMVF9BQ0NPVU5UOiBBY2NvdW50ID0ge1xuICBpZDogREVGQVVMVF9BQ0NPVU5UX0lELFxuICBuYW1lOiBERUZBVUxUX0FDQ09VTlRfTkFNRSxcbiAgdHlwZTogQWNjb3VudFR5cGUuT1RIRVIsXG4gIGNyZWF0ZWRBdDogbmV3IERhdGUoMCkudG9JU09TdHJpbmcoKSxcbiAgaXNEZWZhdWx0OiB0cnVlXG59O1xuXG5jb25zdCBBQ0NPVU5UX1RZUEVfTEFCRUxTOiBSZWNvcmQ8QWNjb3VudFR5cGUsIHN0cmluZz4gPSB7XG4gIFtBY2NvdW50VHlwZS5DSEVRVUlOR106ICdDaGVxdWluZycsXG4gIFtBY2NvdW50VHlwZS5TQVZJTkddOiAnU2F2aW5ncycsXG4gIFtBY2NvdW50VHlwZS5DUkVESVRdOiAnQ3JlZGl0JyxcbiAgW0FjY291bnRUeXBlLk9USEVSXTogJ090aGVyJ1xufTtcblxuY29uc3QgQUNDT1VOVF9UWVBFX0VNT0pJUzogUmVjb3JkPEFjY291bnRUeXBlLCBzdHJpbmc+ID0ge1xuICBbQWNjb3VudFR5cGUuQ0hFUVVJTkddOiAn8J+PpicsXG4gIFtBY2NvdW50VHlwZS5TQVZJTkddOiAn8J+PpicsXG4gIFtBY2NvdW50VHlwZS5DUkVESVRdOiAn8J+SsycsXG4gIFtBY2NvdW50VHlwZS5PVEhFUl06ICfwn4+mJ1xufTtcblxubGV0IGhhc1dhcm5lZEFib3V0SWRGYWxsYmFjayA9IGZhbHNlO1xuICBcbi8vIEhlbHBlciBmdW5jdGlvbiB0byBnZW5lcmF0ZSBhIHVuaXF1ZSBJRFxuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlSWQoKTogc3RyaW5nIHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZGF0ZVBhcnQgPSBmb3JtYXREYXRlKG5vdykucmVwbGFjZSgvLS9nLCAnJyk7XG4gIGNvbnN0IHRpbWVQYXJ0ID0gW1xuICAgIFN0cmluZyhub3cuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICBTdHJpbmcobm93LmdldFNlY29uZHMoKSkucGFkU3RhcnQoMiwgJzAnKVxuICBdLmpvaW4oJycpO1xuICBjb25zdCByYW5kb21QYXJ0ID0gdHlwZW9mIGNyeXB0byAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIGNyeXB0by5yYW5kb21VVUlEID09PSAnZnVuY3Rpb24nXG4gICAgPyBjcnlwdG8ucmFuZG9tVVVJRCgpLnJlcGxhY2UoLy0vZywgJycpLnNsaWNlKDAsIDgpXG4gICAgOiBmYWxsYmFja1JhbmRvbUlkUGFydCgpO1xuXG4gIHJldHVybiBgJHtkYXRlUGFydH0tJHt0aW1lUGFydH0tJHtyYW5kb21QYXJ0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVBY2NvdW50TmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbmFtZS50cmltKCkucmVwbGFjZSgvXFxzKy9nLCAnICcpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QWNjb3VudFJlZmVyZW5jZSh0eXBlOiBBY2NvdW50VHlwZSwgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZE5hbWUgPSBub3JtYWxpemVBY2NvdW50TmFtZShuYW1lKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gYCR7dHlwZX0tJHtub3JtYWxpemVkTmFtZX1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VBY2NvdW50UmVmZXJlbmNlKGFjY291bnQ/OiBzdHJpbmcgfCBudWxsKTogeyB0eXBlOiBBY2NvdW50VHlwZTsgbmFtZTogc3RyaW5nOyByZWZlcmVuY2U6IHN0cmluZyB9IHtcbiAgaWYgKCFhY2NvdW50KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IERFRkFVTFRfQUNDT1VOVC50eXBlLFxuICAgICAgbmFtZTogREVGQVVMVF9BQ0NPVU5ULm5hbWUsXG4gICAgICByZWZlcmVuY2U6IGZvcm1hdEFjY291bnRSZWZlcmVuY2UoREVGQVVMVF9BQ0NPVU5ULnR5cGUsIERFRkFVTFRfQUNDT1VOVC5uYW1lKVxuICAgIH07XG4gIH1cblxuICBjb25zdCBbcmF3VHlwZSwgLi4ubmFtZVBhcnRzXSA9IGFjY291bnQuc3BsaXQoJy0nKTtcbiAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSByYXdUeXBlPy50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCB0eXBlID0gbm9ybWFsaXplZFR5cGUgPT09IEFjY291bnRUeXBlLkNSRURJVFxuICAgID8gQWNjb3VudFR5cGUuQ1JFRElUXG4gICAgOiBub3JtYWxpemVkVHlwZSA9PT0gQWNjb3VudFR5cGUuU0FWSU5HXG4gICAgICA/IEFjY291bnRUeXBlLlNBVklOR1xuICAgICAgOiBub3JtYWxpemVkVHlwZSA9PT0gQWNjb3VudFR5cGUuT1RIRVJcbiAgICAgICAgPyBBY2NvdW50VHlwZS5PVEhFUlxuICAgICAgICA6IEFjY291bnRUeXBlLkNIRVFVSU5HO1xuICBjb25zdCByYXdOYW1lID0gbm9ybWFsaXplQWNjb3VudE5hbWUobmFtZVBhcnRzLmpvaW4oJy0nKSkgfHwgQUNDT1VOVF9UWVBFX0xBQkVMU1t0eXBlXTtcbiAgY29uc3QgbmFtZSA9IHJhd05hbWVcbiAgICAuc3BsaXQoJyAnKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAubWFwKHBhcnQgPT4gcGFydC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnQuc2xpY2UoMSkpXG4gICAgLmpvaW4oJyAnKTtcblxuICByZXR1cm4ge1xuICAgIHR5cGUsXG4gICAgbmFtZSxcbiAgICByZWZlcmVuY2U6IGZvcm1hdEFjY291bnRSZWZlcmVuY2UodHlwZSwgcmF3TmFtZSlcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEFjY291bnRUeXBlTGFiZWwodHlwZTogQWNjb3VudFR5cGUpOiBzdHJpbmcge1xuICByZXR1cm4gQUNDT1VOVF9UWVBFX0xBQkVMU1t0eXBlXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEFjY291bnRFbW9qaSh0eXBlOiBBY2NvdW50VHlwZSk6IHN0cmluZyB7XG4gIHJldHVybiBBQ0NPVU5UX1RZUEVfRU1PSklTW3R5cGVdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGFsZXR0ZUNvbG9yKGNvbG9yPzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWNvbG9yKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBpZiAoL14jWzAtOWEtZl17Nn0kL2kudGVzdChjb2xvcikpIHtcbiAgICByZXR1cm4gY29sb3I7XG4gIH1cblxuICBpZiAoL14jWzAtOWEtZl17OH0kL2kudGVzdChjb2xvcikpIHtcbiAgICByZXR1cm4gY29sb3Iuc2xpY2UoMCwgNyk7XG4gIH1cblxuICBpZiAoL14jWzAtOWEtZl17M30kL2kudGVzdChjb2xvcikpIHtcbiAgICByZXR1cm4gYCMke2NvbG9yLnNsaWNlKDEpLnNwbGl0KCcnKS5tYXAoY2hhciA9PiBgJHtjaGFyfSR7Y2hhcn1gKS5qb2luKCcnKX1gO1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBY2NvdW50Q29sb3IoYWNjb3VudDogQWNjb3VudCwgYWNjb3VudHM6IEFjY291bnRbXSA9IFthY2NvdW50XSk6IHN0cmluZyB7XG4gIGNvbnN0IHN0b3JlZENvbG9yID0gbm9ybWFsaXplUGFsZXR0ZUNvbG9yKGFjY291bnQuY29sb3IpO1xuICBpZiAoc3RvcmVkQ29sb3IpIHtcbiAgICByZXR1cm4gc3RvcmVkQ29sb3I7XG4gIH1cblxuICBjb25zdCBwYWxldHRlID0gQ29sb3JQYWxldHRlLmNvbG9ycy5tYXAoY29sb3IgPT4gY29sb3Iuc2xpY2UoMCwgNykpO1xuICBjb25zdCBzdGFibGVLZXkgPSBhY2NvdW50LmlkIHx8IGZvcm1hdEFjY291bnRSZWZlcmVuY2UoYWNjb3VudC50eXBlLCBhY2NvdW50Lm5hbWUpO1xuICBjb25zdCBpbmRleCA9IEFycmF5LmZyb20oc3RhYmxlS2V5KS5yZWR1Y2UoKGhhc2gsIGNoYXJhY3RlcikgPT4ge1xuICAgIHJldHVybiAoKGhhc2ggKiAzMSkgKyBjaGFyYWN0ZXIuY2hhckNvZGVBdCgwKSkgPj4+IDA7XG4gIH0sIDApICUgcGFsZXR0ZS5sZW5ndGg7XG5cbiAgcmV0dXJuIHBhbGV0dGVbaW5kZXhdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TmV4dEFjY291bnRDb2xvcihhY2NvdW50czogQWNjb3VudFtdKTogc3RyaW5nIHtcbiAgY29uc3QgcGFsZXR0ZSA9IENvbG9yUGFsZXR0ZS5jb2xvcnMubWFwKGNvbG9yID0+IGNvbG9yLnNsaWNlKDAsIDcpKTtcbiAgY29uc3QgdXNlZENvbG9ycyA9IG5ldyBTZXQoYWNjb3VudHNcbiAgICAubWFwKGFjY291bnQgPT4gbm9ybWFsaXplUGFsZXR0ZUNvbG9yKGFjY291bnQuY29sb3IpKVxuICAgIC5maWx0ZXIoKGNvbG9yKTogY29sb3IgaXMgc3RyaW5nID0+ICEhY29sb3IpKTtcblxuICBjb25zdCBhdmFpbGFibGVDb2xvciA9IHBhbGV0dGUuZmluZChjb2xvciA9PiAhdXNlZENvbG9ycy5oYXMoY29sb3IpKTtcbiAgaWYgKGF2YWlsYWJsZUNvbG9yKSB7XG4gICAgcmV0dXJuIGF2YWlsYWJsZUNvbG9yO1xuICB9XG5cbiAgcmV0dXJuIHBhbGV0dGVbYWNjb3VudHMubGVuZ3RoICUgcGFsZXR0ZS5sZW5ndGhdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcGFyZUFjY291bnRzKGE6IEFjY291bnQsIGI6IEFjY291bnQpOiBudW1iZXIge1xuICBpZiAoYS5pc0RlZmF1bHQgJiYgIWIuaXNEZWZhdWx0KSB7XG4gICAgcmV0dXJuIC0xO1xuICB9XG5cbiAgaWYgKCFhLmlzRGVmYXVsdCAmJiBiLmlzRGVmYXVsdCkge1xuICAgIHJldHVybiAxO1xuICB9XG5cbiAgY29uc3Qgb3JkZXIgPSB7XG4gICAgW0FjY291bnRUeXBlLkNIRVFVSU5HXTogMSxcbiAgICBbQWNjb3VudFR5cGUuQ1JFRElUXTogMixcbiAgICBbQWNjb3VudFR5cGUuU0FWSU5HXTogMyxcbiAgICBbQWNjb3VudFR5cGUuT1RIRVJdOiA0XG4gIH07XG5cbiAgY29uc3QgdHlwZURpZmZlcmVuY2UgPSBvcmRlclthLnR5cGVdIC0gb3JkZXJbYi50eXBlXTtcbiAgaWYgKHR5cGVEaWZmZXJlbmNlICE9PSAwKSB7XG4gICAgcmV0dXJuIHR5cGVEaWZmZXJlbmNlO1xuICB9XG5cbiAgY29uc3QgY3JlYXRlZEF0RGlmZmVyZW5jZSA9IG5ldyBEYXRlKGEuY3JlYXRlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShiLmNyZWF0ZWRBdCkuZ2V0VGltZSgpO1xuICBpZiAoY3JlYXRlZEF0RGlmZmVyZW5jZSAhPT0gMCkge1xuICAgIHJldHVybiBjcmVhdGVkQXREaWZmZXJlbmNlO1xuICB9XG5cbiAgcmV0dXJuIGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSk7XG59XG5cbmZ1bmN0aW9uIGZhbGxiYWNrUmFuZG9tSWRQYXJ0KCk6IHN0cmluZyB7XG4gIGlmICghaGFzV2FybmVkQWJvdXRJZEZhbGxiYWNrKSB7XG4gICAgY29uc29sZS53YXJuKCdFeHBlbnNpY2E6IGNyeXB0by5yYW5kb21VVUlEKCkgdW5hdmFpbGFibGUsIHVzaW5nIGZhbGxiYWNrIHRyYW5zYWN0aW9uIElEIGdlbmVyYXRpb24uJyk7XG4gICAgaGFzV2FybmVkQWJvdXRJZEZhbGxiYWNrID0gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCAxMCkucGFkRW5kKDgsICcwJyk7XG59XG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGZvcm1hdCBhIHRpbWVcbiAgZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFRpbWUoZGF0ZTogRGF0ZSA9IG5ldyBEYXRlKCkpOiBzdHJpbmcge1xuICAgIGNvbnN0IGhvdXJzID0gU3RyaW5nKGRhdGUuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgICBjb25zdCBtaW51dGVzID0gU3RyaW5nKGRhdGUuZ2V0TWludXRlcygpKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIGNvbnN0IHNlY29uZHMgPSBTdHJpbmcoZGF0ZS5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gICAgcmV0dXJuIGAke2hvdXJzfToke21pbnV0ZXN9OiR7c2Vjb25kc31gO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0VGltZUluU2Vjb25kcyh0aW1lOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgICBpZiAoIXRpbWUpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoID0gdGltZS5tYXRjaCgvXihcXGR7Mn0pOihcXGR7Mn0pOihcXGR7Mn0pJC8pO1xuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGhvdXJzID0gTnVtYmVyKG1hdGNoWzFdKTtcbiAgICBjb25zdCBtaW51dGVzID0gTnVtYmVyKG1hdGNoWzJdKTtcbiAgICBjb25zdCBzZWNvbmRzID0gTnVtYmVyKG1hdGNoWzNdKTtcblxuICAgIGlmIChob3VycyA+IDIzIHx8IG1pbnV0ZXMgPiA1OSB8fCBzZWNvbmRzID4gNTkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiBob3VycyAqIDM2MDAgKyBtaW51dGVzICogNjAgKyBzZWNvbmRzO1xuICB9XG5cbiAgZXhwb3J0IGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uVGltZSh0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24pOiBzdHJpbmcgfCBudWxsIHtcbiAgICBpZiAoZ2V0VGltZUluU2Vjb25kcyh0cmFuc2FjdGlvbi50aW1lKSAhPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHRyYW5zYWN0aW9uLnRpbWUhO1xuICAgIH1cblxuICAgIGNvbnN0IGlkVGltZU1hdGNoID0gdHJhbnNhY3Rpb24uaWQubWF0Y2goL15cXGR7OH0tKFxcZHsyfSkoXFxkezJ9KShcXGR7Mn0pLS8pO1xuICAgIGlmICghaWRUaW1lTWF0Y2gpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWUgPSBgJHtpZFRpbWVNYXRjaFsxXX06JHtpZFRpbWVNYXRjaFsyXX06JHtpZFRpbWVNYXRjaFszXX1gO1xuICAgIHJldHVybiBnZXRUaW1lSW5TZWNvbmRzKHRpbWUpICE9PSBudWxsID8gdGltZSA6IG51bGw7XG4gIH1cblxuICBleHBvcnQgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EaXNwbGF5VGltZSh0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24pOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gZ2V0VHJhbnNhY3Rpb25UaW1lKHRyYW5zYWN0aW9uKT8uc2xpY2UoMCwgNSkgPz8gbnVsbDtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXRDYXRlZ29yeVR5cGVGb3JUcmFuc2FjdGlvblR5cGUodHlwZTogVHJhbnNhY3Rpb25UeXBlKTogQ2F0ZWdvcnlUeXBlIHtcbiAgICByZXR1cm4gdHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLklOQ09NRSA/IENhdGVnb3J5VHlwZS5JTkNPTUUgOiBDYXRlZ29yeVR5cGUuRVhQRU5TRTtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBpc0ludGVybmFsVHJhbnNhY3Rpb24odHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTlRFUk5BTDtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0VHJhbnNhY3Rpb25DYXRlZ29yeSh0eXBlOiBUcmFuc2FjdGlvblR5cGUsIGNhdGVnb3JpZXM6IENhdGVnb3J5W10pOiBzdHJpbmcge1xuICAgIGlmICh0eXBlID09PSBUcmFuc2FjdGlvblR5cGUuSU5URVJOQUwpIHtcbiAgICAgIHJldHVybiBJTlRFUk5BTF9DQVRFR09SWV9JRDtcbiAgICB9XG5cbiAgICBjb25zdCBmYWxsYmFja0lkID0gdHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLklOQ09NRSA/ICdvdGhlcl9pbmNvbWUnIDogJ290aGVyX2V4cGVuc2UnO1xuICAgIHJldHVybiBjYXRlZ29yaWVzLmZpbmQoY2F0ZWdvcnkgPT4gY2F0ZWdvcnkuaWQgPT09IGZhbGxiYWNrSWQpPy5pZFxuICAgICAgfHwgY2F0ZWdvcmllcy5maW5kKGNhdGVnb3J5ID0+IGNhdGVnb3J5LnR5cGUgPT09IGdldENhdGVnb3J5VHlwZUZvclRyYW5zYWN0aW9uVHlwZSh0eXBlKSk/LmlkXG4gICAgICB8fCAnJztcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBzb3J0VHJhbnNhY3Rpb25zQnlEYXRlVGltZURlc2M8VCBleHRlbmRzIFRyYW5zYWN0aW9uPih0cmFuc2FjdGlvbnM6IFRbXSk6IFRbXSB7XG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uc1xuICAgICAgLm1hcCgodHJhbnNhY3Rpb24sIGluZGV4KSA9PiAoeyB0cmFuc2FjdGlvbiwgaW5kZXggfSkpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBjb25zdCBkYXRlRGlmZiA9IHBhcnNlTG9jYWxEYXRlKGIudHJhbnNhY3Rpb24uZGF0ZSkuZ2V0VGltZSgpIC0gcGFyc2VMb2NhbERhdGUoYS50cmFuc2FjdGlvbi5kYXRlKS5nZXRUaW1lKCk7XG4gICAgICAgIGlmIChkYXRlRGlmZiAhPT0gMCkge1xuICAgICAgICAgIHJldHVybiBkYXRlRGlmZjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFUaW1lID0gZ2V0VGltZUluU2Vjb25kcyhnZXRUcmFuc2FjdGlvblRpbWUoYS50cmFuc2FjdGlvbikgfHwgdW5kZWZpbmVkKTtcbiAgICAgICAgY29uc3QgYlRpbWUgPSBnZXRUaW1lSW5TZWNvbmRzKGdldFRyYW5zYWN0aW9uVGltZShiLnRyYW5zYWN0aW9uKSB8fCB1bmRlZmluZWQpO1xuXG4gICAgICAgIGlmIChhVGltZSAhPT0gbnVsbCAmJiBiVGltZSAhPT0gbnVsbCAmJiBhVGltZSAhPT0gYlRpbWUpIHtcbiAgICAgICAgICByZXR1cm4gYlRpbWUgLSBhVGltZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhVGltZSAhPT0gbnVsbCAmJiBiVGltZSAhPT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBhLmluZGV4IC0gYi5pbmRleDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBiLmluZGV4IC0gYS5pbmRleDtcbiAgICAgIH0pXG4gICAgICAubWFwKCh7IHRyYW5zYWN0aW9uIH0pID0+IHRyYW5zYWN0aW9uKTtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZCh0cmFuc2FjdGlvbnM6IFRyYW5zYWN0aW9uW10pOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHtcbiAgICBsZXQgcnVubmluZ0JhbGFuY2UgPSAwO1xuXG4gICAgcmV0dXJuIHNvcnRUcmFuc2FjdGlvbnNCeURhdGVUaW1lRGVzYyh0cmFuc2FjdGlvbnMpXG4gICAgICAucmV2ZXJzZSgpXG4gICAgICAucmVkdWNlKChiYWxhbmNlcywgdHJhbnNhY3Rpb24pID0+IHtcbiAgICAgICAgaWYgKHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTkNPTUUpIHtcbiAgICAgICAgICBydW5uaW5nQmFsYW5jZSArPSB0cmFuc2FjdGlvbi5hbW91bnQ7XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNhY3Rpb24udHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLkVYUEVOU0UpIHtcbiAgICAgICAgICBydW5uaW5nQmFsYW5jZSAtPSB0cmFuc2FjdGlvbi5hbW91bnQ7XG4gICAgICAgIH1cblxuICAgICAgICBiYWxhbmNlc1t0cmFuc2FjdGlvbi5pZF0gPSBydW5uaW5nQmFsYW5jZTtcbiAgICAgICAgcmV0dXJuIGJhbGFuY2VzO1xuICAgICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgbnVtYmVyPik7XG4gIH1cbiAgXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmb3JtYXQgYSBkYXRlXG4gIGV4cG9ydCBmdW5jdGlvbiBmb3JtYXREYXRlKGRhdGU6IERhdGUpOiBzdHJpbmcge1xuICAgIGNvbnN0IHllYXIgPSBkYXRlLmdldEZ1bGxZZWFyKCk7XG4gICAgY29uc3QgbW9udGggPSBTdHJpbmcoZGF0ZS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgICBjb25zdCBkYXkgPSBTdHJpbmcoZGF0ZS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gICAgcmV0dXJuIGAke3llYXJ9LSR7bW9udGh9LSR7ZGF5fWA7XG4gIH1cblxuICAvLyBQYXJzZSBhIFlZWVktTU0tREQgc3RyaW5nIGFzIGEgbG9jYWwgY2FsZW5kYXIgZGF0ZSBpbnN0ZWFkIG9mIFVUQy5cbiAgZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTG9jYWxEYXRlKGRhdGVTdHJpbmc6IHN0cmluZyk6IERhdGUge1xuICAgIGNvbnN0IFt5ZWFyLCBtb250aCwgZGF5XSA9IGRhdGVTdHJpbmcuc3Vic3RyaW5nKDAsIDEwKS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICAgIHJldHVybiBuZXcgRGF0ZSh5ZWFyLCBtb250aCAtIDEsIGRheSk7XG4gIH1cblxuICAvLyBTaGFyZWQgY2F0ZWdvcnkgY29sb3JzIGZvciBkYXNoYm9hcmQsIGNoaXBzLCBhbmQgY2FsZW5kYXIgYnJlYWtkb3ducy5cbiAgZXhwb3J0IGZ1bmN0aW9uIGdldENhdGVnb3J5Q29sb3IoY2F0ZWdvcnlOYW1lT3JJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjb2xvcktleSA9IGNhdGVnb3J5TmFtZU9ySWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgcmV0dXJuIENBVEVHT1JZX0NPTE9SU19CWV9JRFtjb2xvcktleV1cbiAgICAgIHx8IENBVEVHT1JZX0NPTE9SU19CWV9OQU1FW2NvbG9yS2V5XVxuICAgICAgfHwgYGhzbCgke3N0cmluZ1RvSHVlKGNhdGVnb3J5TmFtZU9ySWQpfSwgNzAlLCA2MCUpYDtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBzdHJpbmdUb0h1ZShzdHI6IHN0cmluZyk6IG51bWJlciB7XG4gICAgbGV0IGhhc2ggPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBoYXNoID0gc3RyLmNoYXJDb2RlQXQoaSkgKyAoKGhhc2ggPDwgNSkgLSBoYXNoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gKChoYXNoICUgMzYwKSArIDM2MCkgJSAzNjA7XG4gIH1cbiAgXG4gIC8vIENvbW1vbiB3b3JsZCBjdXJyZW5jaWVzXG4gIGV4cG9ydCBjb25zdCBDT01NT05fQ1VSUkVOQ0lFUzogQ3VycmVuY3lbXSA9IFtcbiAgICB7IGNvZGU6ICdVU0QnLCBuYW1lOiAnVVMgRG9sbGFyJywgc3ltYm9sOiAnJCcgfSxcbiAgICB7IGNvZGU6ICdFVVInLCBuYW1lOiAnRXVybycsIHN5bWJvbDogJ+KCrCcgfSxcbiAgICB7IGNvZGU6ICdHQlAnLCBuYW1lOiAnQnJpdGlzaCBQb3VuZCcsIHN5bWJvbDogJ8KjJyB9LFxuICAgIHsgY29kZTogJ0pQWScsIG5hbWU6ICdKYXBhbmVzZSBZZW4nLCBzeW1ib2w6ICfCpScgfSxcbiAgICB7IGNvZGU6ICdBVUQnLCBuYW1lOiAnQXVzdHJhbGlhbiBEb2xsYXInLCBzeW1ib2w6ICdBJCcgfSxcbiAgICB7IGNvZGU6ICdDQUQnLCBuYW1lOiAnQ2FuYWRpYW4gRG9sbGFyJywgc3ltYm9sOiAnQyQnIH0sXG4gICAgeyBjb2RlOiAnQ0hGJywgbmFtZTogJ1N3aXNzIEZyYW5jJywgc3ltYm9sOiAnQ0hGJyB9LFxuICAgIHsgY29kZTogJ0NOWScsIG5hbWU6ICdDaGluZXNlIFl1YW4nLCBzeW1ib2w6ICfCpScgfSxcbiAgICB7IGNvZGU6ICdJTlInLCBuYW1lOiAnSW5kaWFuIFJ1cGVlJywgc3ltYm9sOiAn4oK5JyB9LFxuICAgIHsgY29kZTogJ0JSTCcsIG5hbWU6ICdCcmF6aWxpYW4gUmVhbCcsIHN5bWJvbDogJ1IkJyB9LFxuICAgIHsgY29kZTogJ1JVQicsIG5hbWU6ICdSdXNzaWFuIFJ1YmxlJywgc3ltYm9sOiAn4oK9JyB9LFxuICAgIHsgY29kZTogJ0tSVycsIG5hbWU6ICdTb3V0aCBLb3JlYW4gV29uJywgc3ltYm9sOiAn4oKpJyB9LFxuICAgIHsgY29kZTogJ1NHRCcsIG5hbWU6ICdTaW5nYXBvcmUgRG9sbGFyJywgc3ltYm9sOiAnUyQnIH0sXG4gICAgeyBjb2RlOiAnTlpEJywgbmFtZTogJ05ldyBaZWFsYW5kIERvbGxhcicsIHN5bWJvbDogJ05aJCcgfSxcbiAgICB7IGNvZGU6ICdNWE4nLCBuYW1lOiAnTWV4aWNhbiBQZXNvJywgc3ltYm9sOiAnTWV4JCcgfSxcbiAgICB7IGNvZGU6ICdIS0QnLCBuYW1lOiAnSG9uZyBLb25nIERvbGxhcicsIHN5bWJvbDogJ0hLJCcgfSxcbiAgICB7IGNvZGU6ICdUUlknLCBuYW1lOiAnVHVya2lzaCBMaXJhJywgc3ltYm9sOiAn4oK6JyB9LFxuICAgIHsgY29kZTogJ1pBUicsIG5hbWU6ICdTb3V0aCBBZnJpY2FuIFJhbmQnLCBzeW1ib2w6ICdSJyB9LFxuICAgIHsgY29kZTogJ1NFSycsIG5hbWU6ICdTd2VkaXNoIEtyb25hJywgc3ltYm9sOiAna3InIH0sXG4gICAgeyBjb2RlOiAnTk9LJywgbmFtZTogJ05vcndlZ2lhbiBLcm9uZScsIHN5bWJvbDogJ2tyJyB9LFxuICAgIHsgY29kZTogJ0RLSycsIG5hbWU6ICdEYW5pc2ggS3JvbmUnLCBzeW1ib2w6ICdrcicgfSxcbiAgICB7IGNvZGU6ICdQTE4nLCBuYW1lOiAnUG9saXNoIFrFgm90eScsIHN5bWJvbDogJ3rFgicgfSxcbiAgICB7IGNvZGU6ICdUSEInLCBuYW1lOiAnVGhhaSBCYWh0Jywgc3ltYm9sOiAn4Li/JyB9LFxuICAgIHsgY29kZTogJ0lEUicsIG5hbWU6ICdJbmRvbmVzaWFuIFJ1cGlhaCcsIHN5bWJvbDogJ1JwJyB9LFxuICAgIHsgY29kZTogJ01ZUicsIG5hbWU6ICdNYWxheXNpYW4gUmluZ2dpdCcsIHN5bWJvbDogJ1JNJyB9LFxuICAgIHsgY29kZTogJ1BIUCcsIG5hbWU6ICdQaGlsaXBwaW5lIFBlc28nLCBzeW1ib2w6ICfigrEnIH0sXG4gICAgeyBjb2RlOiAnSUxTJywgbmFtZTogJ0lzcmFlbGkgU2hla2VsJywgc3ltYm9sOiAn4oKqJyB9LFxuICAgIHsgY29kZTogJ0FFRCcsIG5hbWU6ICdVQUUgRGlyaGFtJywgc3ltYm9sOiAn2K8u2KUnIH0sXG4gICAgeyBjb2RlOiAnU0FSJywgbmFtZTogJ1NhdWRpIFJpeWFsJywgc3ltYm9sOiAn77e8JyB9LFxuICAgIHsgY29kZTogJ0NaSycsIG5hbWU6ICdDemVjaCBLb3J1bmEnLCBzeW1ib2w6ICdLxI0nIH0sXG4gICAgeyBjb2RlOiAnSFVGJywgbmFtZTogJ0h1bmdhcmlhbiBGb3JpbnQnLCBzeW1ib2w6ICdGdCcgfSxcbiAgICB7IGNvZGU6ICdST04nLCBuYW1lOiAnUm9tYW5pYW4gTGV1Jywgc3ltYm9sOiAnbGVpJyB9LFxuICAgIHsgY29kZTogJ0hSSycsIG5hbWU6ICdDcm9hdGlhbiBLdW5hJywgc3ltYm9sOiAna24nIH0sXG4gICAgeyBjb2RlOiAnQkdOJywgbmFtZTogJ0J1bGdhcmlhbiBMZXYnLCBzeW1ib2w6ICfQu9CyJyB9LFxuICAgIHsgY29kZTogJ0lTSycsIG5hbWU6ICdJY2VsYW5kaWMgS3LDs25hJywgc3ltYm9sOiAna3InIH0sXG4gICAgeyBjb2RlOiAnQ0xQJywgbmFtZTogJ0NoaWxlYW4gUGVzbycsIHN5bWJvbDogJ0NMUCQnIH0sXG4gICAgeyBjb2RlOiAnQ09QJywgbmFtZTogJ0NvbG9tYmlhbiBQZXNvJywgc3ltYm9sOiAnQ09MJCcgfSxcbiAgICB7IGNvZGU6ICdQRU4nLCBuYW1lOiAnUGVydXZpYW4gU29sJywgc3ltYm9sOiAnUy8nIH0sXG4gICAgeyBjb2RlOiAnQVJTJywgbmFtZTogJ0FyZ2VudGluZSBQZXNvJywgc3ltYm9sOiAnQVIkJyB9LFxuICAgIHsgY29kZTogJ1ZORCcsIG5hbWU6ICdWaWV0bmFtZXNlIERvbmcnLCBzeW1ib2w6ICfigqsnIH0sXG4gICAgeyBjb2RlOiAnVUFIJywgbmFtZTogJ1VrcmFpbmlhbiBIcnl2bmlhJywgc3ltYm9sOiAn4oK0JyB9LFxuICAgIHsgY29kZTogJ0VHUCcsIG5hbWU6ICdFZ3lwdGlhbiBQb3VuZCcsIHN5bWJvbDogJ0XCoycgfSxcbiAgICB7IGNvZGU6ICdOR04nLCBuYW1lOiAnTmlnZXJpYW4gTmFpcmEnLCBzeW1ib2w6ICfigqYnIH0sXG4gICAgeyBjb2RlOiAnUEtSJywgbmFtZTogJ1Bha2lzdGFuaSBSdXBlZScsIHN5bWJvbDogJ+KCqCcgfSxcbiAgICB7IGNvZGU6ICdCRFQnLCBuYW1lOiAnQmFuZ2xhZGVzaGkgVGFrYScsIHN5bWJvbDogJ+CnsycgfSxcbiAgICB7IGNvZGU6ICdMS1InLCBuYW1lOiAnU3JpIExhbmthbiBSdXBlZScsIHN5bWJvbDogJ1JzJyB9LFxuICAgIHsgY29kZTogJ0tXRCcsIG5hbWU6ICdLdXdhaXRpIERpbmFyJywgc3ltYm9sOiAn2K8u2YMnIH0sXG4gICAgeyBjb2RlOiAnUUFSJywgbmFtZTogJ1FhdGFyaSBSaXlhbCcsIHN5bWJvbDogJ++3vCcgfSxcbiAgICB7IGNvZGU6ICdPTVInLCBuYW1lOiAnT21hbmkgUmlhbCcsIHN5bWJvbDogJ++3vCcgfSxcbiAgICB7IGNvZGU6ICdCSEQnLCBuYW1lOiAnQmFocmFpbmkgRGluYXInLCBzeW1ib2w6ICcu2K8u2KgnIH0sXG4gICAgeyBjb2RlOiAnSk9EJywgbmFtZTogJ0pvcmRhbmlhbiBEaW5hcicsIHN5bWJvbDogJ9ivLtinJyB9LFxuICAgIHsgY29kZTogJ0xCUCcsIG5hbWU6ICdMZWJhbmVzZSBQb3VuZCcsIHN5bWJvbDogJ9mELtmEJyB9LFxuICAgIHsgY29kZTogJ01BRCcsIG5hbWU6ICdNb3JvY2NhbiBEaXJoYW0nLCBzeW1ib2w6ICfYry7ZhS4nIH0sXG4gICAgeyBjb2RlOiAnVE5EJywgbmFtZTogJ1R1bmlzaWFuIERpbmFyJywgc3ltYm9sOiAn2K8u2KonIH0sXG4gICAgeyBjb2RlOiAnRFpEJywgbmFtZTogJ0FsZ2VyaWFuIERpbmFyJywgc3ltYm9sOiAn2K8u2KwnIH0sXG4gICAgeyBjb2RlOiAnSVFEJywgbmFtZTogJ0lyYXFpIERpbmFyJywgc3ltYm9sOiAn2Lku2K8nIH0sXG4gICAgeyBjb2RlOiAnU1lQJywgbmFtZTogJ1N5cmlhbiBQb3VuZCcsIHN5bWJvbDogJ9mELtizJyB9LFxuICAgIHsgY29kZTogJ1lFUicsIG5hbWU6ICdZZW1lbmkgUmlhbCcsIHN5bWJvbDogJ++3vCcgfSxcbiAgICB7IGNvZGU6ICdBRk4nLCBuYW1lOiAnQWZnaGFuIEFmZ2hhbmknLCBzeW1ib2w6ICfYiycgfSxcbiAgICB7IGNvZGU6ICdOUFInLCBuYW1lOiAnTmVwYWxlc2UgUnVwZWUnLCBzeW1ib2w6ICfigqgnIH0sXG4gICAgeyBjb2RlOiAnTU1LJywgbmFtZTogJ015YW5tYXIgS3lhdCcsIHN5bWJvbDogJ0snIH0sXG4gICAgeyBjb2RlOiAnS0hSJywgbmFtZTogJ0NhbWJvZGlhbiBSaWVsJywgc3ltYm9sOiAn4Z+bJyB9LFxuICAgIHsgY29kZTogJ0xBSycsIG5hbWU6ICdMYW8gS2lwJywgc3ltYm9sOiAn4oKtJyB9LFxuICAgIHsgY29kZTogJ01OVCcsIG5hbWU6ICdNb25nb2xpYW4gVHVncmlrJywgc3ltYm9sOiAn4oKuJyB9LFxuICAgIHsgY29kZTogJ0taVCcsIG5hbWU6ICdLYXpha2hzdGFuaSBUZW5nZScsIHN5bWJvbDogJ+KCuCcgfSxcbiAgICB7IGNvZGU6ICdVWlMnLCBuYW1lOiAnVXpiZWtpc3RhbmkgU29tJywgc3ltYm9sOiAn0LvQsicgfSxcbiAgICB7IGNvZGU6ICdUSlMnLCBuYW1lOiAnVGFqaWtpc3RhbmkgU29tb25pJywgc3ltYm9sOiAn0IXQnCcgfSxcbiAgICB7IGNvZGU6ICdUTVQnLCBuYW1lOiAnVHVya21lbmlzdGFuaSBNYW5hdCcsIHN5bWJvbDogJ1QnIH0sXG4gICAgeyBjb2RlOiAnR0VMJywgbmFtZTogJ0dlb3JnaWFuIExhcmknLCBzeW1ib2w6ICfigr4nIH0sXG4gICAgeyBjb2RlOiAnQU1EJywgbmFtZTogJ0FybWVuaWFuIERyYW0nLCBzeW1ib2w6ICfWjycgfSxcbiAgICB7IGNvZGU6ICdBWk4nLCBuYW1lOiAnQXplcmJhaWphbmkgTWFuYXQnLCBzeW1ib2w6ICfigrwnIH0sXG4gICAgeyBjb2RlOiAnQllOJywgbmFtZTogJ0JlbGFydXNpYW4gUnVibGUnLCBzeW1ib2w6ICdCcicgfSxcbiAgICB7IGNvZGU6ICdNREwnLCBuYW1lOiAnTW9sZG92YW4gTGV1Jywgc3ltYm9sOiAnTCcgfSxcbiAgICB7IGNvZGU6ICdSU0QnLCBuYW1lOiAnU2VyYmlhbiBEaW5hcicsIHN5bWJvbDogJ9C00LjQvS4nIH0sXG4gICAgeyBjb2RlOiAnTUtEJywgbmFtZTogJ01hY2Vkb25pYW4gRGVuYXInLCBzeW1ib2w6ICfQtNC10L0nIH0sXG4gICAgeyBjb2RlOiAnQkFNJywgbmFtZTogJ0Jvc25pYS1IZXJ6ZWdvdmluYSBDb252ZXJ0aWJsZSBNYXJrJywgc3ltYm9sOiAnS00nIH0sXG4gICAgeyBjb2RlOiAnQUxMJywgbmFtZTogJ0FsYmFuaWFuIExlaycsIHN5bWJvbDogJ0wnIH0sXG4gICAgeyBjb2RlOiAnWENEJywgbmFtZTogJ0Vhc3QgQ2FyaWJiZWFuIERvbGxhcicsIHN5bWJvbDogJ0VDJCcgfSxcbiAgICB7IGNvZGU6ICdCQkQnLCBuYW1lOiAnQmFyYmFkaWFuIERvbGxhcicsIHN5bWJvbDogJ0JkcyQnIH0sXG4gICAgeyBjb2RlOiAnQlpEJywgbmFtZTogJ0JlbGl6ZSBEb2xsYXInLCBzeW1ib2w6ICdCWiQnIH0sXG4gICAgeyBjb2RlOiAnR1lEJywgbmFtZTogJ0d1eWFuZXNlIERvbGxhcicsIHN5bWJvbDogJ0ckJyB9LFxuICAgIHsgY29kZTogJ0pNRCcsIG5hbWU6ICdKYW1haWNhbiBEb2xsYXInLCBzeW1ib2w6ICdKJCcgfSxcbiAgICB7IGNvZGU6ICdUVEQnLCBuYW1lOiAnVHJpbmlkYWQgYW5kIFRvYmFnbyBEb2xsYXInLCBzeW1ib2w6ICdUVCQnIH0sXG4gICAgeyBjb2RlOiAnQlNEJywgbmFtZTogJ0JhaGFtaWFuIERvbGxhcicsIHN5bWJvbDogJ0IkJyB9LFxuICAgIHsgY29kZTogJ0JNRCcsIG5hbWU6ICdCZXJtdWRpYW4gRG9sbGFyJywgc3ltYm9sOiAnQkQkJyB9LFxuICAgIHsgY29kZTogJ0tZRCcsIG5hbWU6ICdDYXltYW4gSXNsYW5kcyBEb2xsYXInLCBzeW1ib2w6ICdDSSQnIH0sXG4gICAgeyBjb2RlOiAnRkpEJywgbmFtZTogJ0ZpamlhbiBEb2xsYXInLCBzeW1ib2w6ICdGSiQnIH0sXG4gICAgeyBjb2RlOiAnU0JEJywgbmFtZTogJ1NvbG9tb24gSXNsYW5kcyBEb2xsYXInLCBzeW1ib2w6ICdTSSQnIH0sXG4gICAgeyBjb2RlOiAnVE9QJywgbmFtZTogJ1RvbmdhbiBQYcq7YW5nYScsIHN5bWJvbDogJ1QkJyB9LFxuICAgIHsgY29kZTogJ1dTVCcsIG5hbWU6ICdTYW1vYW4gVGFsYScsIHN5bWJvbDogJ1dTJCcgfSxcbiAgICB7IGNvZGU6ICdWVVYnLCBuYW1lOiAnVmFudWF0dSBWYXR1Jywgc3ltYm9sOiAnVlQnIH0sXG4gICAgeyBjb2RlOiAnWFBGJywgbmFtZTogJ0NGUCBGcmFuYycsIHN5bWJvbDogJ+KCoycgfSxcbiAgICB7IGNvZGU6ICdOSU8nLCBuYW1lOiAnTmljYXJhZ3VhbiBDw7NyZG9iYScsIHN5bWJvbDogJ0MkJyB9LFxuICAgIHsgY29kZTogJ0hOTCcsIG5hbWU6ICdIb25kdXJhbiBMZW1waXJhJywgc3ltYm9sOiAnTCcgfSxcbiAgICB7IGNvZGU6ICdHVFEnLCBuYW1lOiAnR3VhdGVtYWxhbiBRdWV0emFsJywgc3ltYm9sOiAnUScgfSxcbiAgICB7IGNvZGU6ICdQWUcnLCBuYW1lOiAnUGFyYWd1YXlhbiBHdWFyYW7DrScsIHN5bWJvbDogJ+KCsicgfSxcbiAgICB7IGNvZGU6ICdCT0InLCBuYW1lOiAnQm9saXZpYW4gQm9saXZpYW5vJywgc3ltYm9sOiAnQnMuJyB9LFxuICAgIHsgY29kZTogJ1VZVScsIG5hbWU6ICdVcnVndWF5YW4gUGVzbycsIHN5bWJvbDogJyRVJyB9LFxuICAgIHsgY29kZTogJ0NSQycsIG5hbWU6ICdDb3N0YSBSaWNhbiBDb2zDs24nLCBzeW1ib2w6ICfigqEnIH0sXG4gICAgeyBjb2RlOiAnUEFCJywgbmFtZTogJ1BhbmFtYW5pYW4gQmFsYm9hJywgc3ltYm9sOiAnQi8uJyB9LFxuICAgIHsgY29kZTogJ0RPUCcsIG5hbWU6ICdEb21pbmljYW4gUGVzbycsIHN5bWJvbDogJ1JEJCcgfSxcbiAgICB7IGNvZGU6ICdIVEcnLCBuYW1lOiAnSGFpdGlhbiBHb3VyZGUnLCBzeW1ib2w6ICdHJyB9LFxuICAgIHsgY29kZTogJ0NVUCcsIG5hbWU6ICdDdWJhbiBQZXNvJywgc3ltYm9sOiAnJE1OJyB9LFxuICAgIHsgY29kZTogJ0FORycsIG5hbWU6ICdOZXRoZXJsYW5kcyBBbnRpbGxlYW4gR3VpbGRlcicsIHN5bWJvbDogJ8aSJyB9LFxuICAgIHsgY29kZTogJ0FXRycsIG5hbWU6ICdBcnViYW4gRmxvcmluJywgc3ltYm9sOiAnxpInIH0sXG4gICAgeyBjb2RlOiAnWEFGJywgbmFtZTogJ0NlbnRyYWwgQWZyaWNhbiBDRkEgRnJhbmMnLCBzeW1ib2w6ICdGQ0ZBJyB9LFxuICAgIHsgY29kZTogJ1hPRicsIG5hbWU6ICdXZXN0IEFmcmljYW4gQ0ZBIEZyYW5jJywgc3ltYm9sOiAnQ0ZBJyB9LFxuICAgIHsgY29kZTogJ1hQRicsIG5hbWU6ICdDRlAgRnJhbmMnLCBzeW1ib2w6ICfigqMnIH0sXG4gICAgeyBjb2RlOiAnQ0RGJywgbmFtZTogJ0NvbmdvbGVzZSBGcmFuYycsIHN5bWJvbDogJ0ZDJyB9LFxuICAgIHsgY29kZTogJ0dIUycsIG5hbWU6ICdHaGFuYWlhbiBDZWRpJywgc3ltYm9sOiAn4oK1JyB9LFxuICAgIHsgY29kZTogJ0tFUycsIG5hbWU6ICdLZW55YW4gU2hpbGxpbmcnLCBzeW1ib2w6ICdLU2gnIH0sXG4gICAgeyBjb2RlOiAnVFpTJywgbmFtZTogJ1RhbnphbmlhbiBTaGlsbGluZycsIHN5bWJvbDogJ1RTaCcgfSxcbiAgICB7IGNvZGU6ICdVR1gnLCBuYW1lOiAnVWdhbmRhbiBTaGlsbGluZycsIHN5bWJvbDogJ1VTaCcgfSxcbiAgICB7IGNvZGU6ICdaTVcnLCBuYW1lOiAnWmFtYmlhbiBLd2FjaGEnLCBzeW1ib2w6ICdaSycgfSxcbiAgICB7IGNvZGU6ICdNVVInLCBuYW1lOiAnTWF1cml0aWFuIFJ1cGVlJywgc3ltYm9sOiAn4oKoJyB9LFxuICAgIHsgY29kZTogJ1NDUicsIG5hbWU6ICdTZXljaGVsbG9pcyBSdXBlZScsIHN5bWJvbDogJ+KCqCcgfSxcbiAgICB7IGNvZGU6ICdNVlInLCBuYW1lOiAnTWFsZGl2aWFuIFJ1Zml5YWEnLCBzeW1ib2w6ICdSZicgfSxcbiAgICB7IGNvZGU6ICdNT1AnLCBuYW1lOiAnTWFjYW5lc2UgUGF0YWNhJywgc3ltYm9sOiAnTU9QJCcgfSxcbiAgICB7IGNvZGU6ICdCTkQnLCBuYW1lOiAnQnJ1bmVpIERvbGxhcicsIHN5bWJvbDogJ0IkJyB9LFxuICAgIHsgY29kZTogJ0tHUycsIG5hbWU6ICdLeXJneXpzdGFuaSBTb20nLCBzeW1ib2w6ICfRgScgfSxcbiAgICB7IGNvZGU6ICdUSlMnLCBuYW1lOiAnVGFqaWtpc3RhbmkgU29tb25pJywgc3ltYm9sOiAn0IXQnCcgfSxcbiAgICB7IGNvZGU6ICdUTVQnLCBuYW1lOiAnVHVya21lbmlzdGFuaSBNYW5hdCcsIHN5bWJvbDogJ1QnIH0sXG4gICAgeyBjb2RlOiAnVVpTJywgbmFtZTogJ1V6YmVraXN0YW5pIFNvbScsIHN5bWJvbDogJ9C70LInIH0sXG4gICAgeyBjb2RlOiAnTU5UJywgbmFtZTogJ01vbmdvbGlhbiBUdWdyaWsnLCBzeW1ib2w6ICfigq4nIH0sXG4gICAgeyBjb2RlOiAnS0hSJywgbmFtZTogJ0NhbWJvZGlhbiBSaWVsJywgc3ltYm9sOiAn4Z+bJyB9LFxuICAgIHsgY29kZTogJ0xBSycsIG5hbWU6ICdMYW8gS2lwJywgc3ltYm9sOiAn4oKtJyB9LFxuICAgIHsgY29kZTogJ01NSycsIG5hbWU6ICdNeWFubWFyIEt5YXQnLCBzeW1ib2w6ICdLJyB9LFxuICAgIHsgY29kZTogJ05QUicsIG5hbWU6ICdOZXBhbGVzZSBSdXBlZScsIHN5bWJvbDogJ+KCqCcgfSxcbiAgICB7IGNvZGU6ICdQS1InLCBuYW1lOiAnUGFraXN0YW5pIFJ1cGVlJywgc3ltYm9sOiAn4oKoJyB9LFxuICAgIHsgY29kZTogJ0xLUicsIG5hbWU6ICdTcmkgTGFua2FuIFJ1cGVlJywgc3ltYm9sOiAnUnMnIH0sXG4gICAgeyBjb2RlOiAnQkRUJywgbmFtZTogJ0JhbmdsYWRlc2hpIFRha2EnLCBzeW1ib2w6ICfgp7MnIH0sXG4gICAgeyBjb2RlOiAnQlROJywgbmFtZTogJ0JodXRhbmVzZSBOZ3VsdHJ1bScsIHN5bWJvbDogJ051LicgfSxcbiAgICB7IGNvZGU6ICdNVlInLCBuYW1lOiAnTWFsZGl2aWFuIFJ1Zml5YWEnLCBzeW1ib2w6ICdSZicgfSxcbiAgICB7IGNvZGU6ICdNVVInLCBuYW1lOiAnTWF1cml0aWFuIFJ1cGVlJywgc3ltYm9sOiAn4oKoJyB9LFxuICAgIHsgY29kZTogJ1NDUicsIG5hbWU6ICdTZXljaGVsbG9pcyBSdXBlZScsIHN5bWJvbDogJ+KCqCcgfSxcbiAgICB7IGNvZGU6ICdaQVInLCBuYW1lOiAnU291dGggQWZyaWNhbiBSYW5kJywgc3ltYm9sOiAnUicgfSxcbiAgICB7IGNvZGU6ICdMU0wnLCBuYW1lOiAnTGVzb3RobyBMb3RpJywgc3ltYm9sOiAnTCcgfSxcbiAgICB7IGNvZGU6ICdOQUQnLCBuYW1lOiAnTmFtaWJpYW4gRG9sbGFyJywgc3ltYm9sOiAnTiQnIH0sXG4gICAgeyBjb2RlOiAnU1pMJywgbmFtZTogJ1N3YXppIExpbGFuZ2VuaScsIHN5bWJvbDogJ0wnIH0sXG4gICAgeyBjb2RlOiAnWk1XJywgbmFtZTogJ1phbWJpYW4gS3dhY2hhJywgc3ltYm9sOiAnWksnIH0sXG4gICAgeyBjb2RlOiAnTVdLJywgbmFtZTogJ01hbGF3aWFuIEt3YWNoYScsIHN5bWJvbDogJ01LJyB9LFxuICAgIHsgY29kZTogJ1pXTCcsIG5hbWU6ICdaaW1iYWJ3ZWFuIERvbGxhcicsIHN5bWJvbDogJ1okJyB9LFxuICAgIHsgY29kZTogJ0FPQScsIG5hbWU6ICdBbmdvbGFuIEt3YW56YScsIHN5bWJvbDogJ0t6JyB9LFxuICAgIHsgY29kZTogJ0JJRicsIG5hbWU6ICdCdXJ1bmRpYW4gRnJhbmMnLCBzeW1ib2w6ICdGQnUnIH0sXG4gICAgeyBjb2RlOiAnQ0RGJywgbmFtZTogJ0NvbmdvbGVzZSBGcmFuYycsIHN5bWJvbDogJ0ZDJyB9LFxuICAgIHsgY29kZTogJ0RKRicsIG5hbWU6ICdEamlib3V0aWFuIEZyYW5jJywgc3ltYm9sOiAnRmRqJyB9LFxuICAgIHsgY29kZTogJ0VSTicsIG5hbWU6ICdFcml0cmVhbiBOYWtmYScsIHN5bWJvbDogJ05maycgfSxcbiAgICB7IGNvZGU6ICdFVEInLCBuYW1lOiAnRXRoaW9waWFuIEJpcnInLCBzeW1ib2w6ICdCcicgfSxcbiAgICB7IGNvZGU6ICdHTUQnLCBuYW1lOiAnR2FtYmlhbiBEYWxhc2knLCBzeW1ib2w6ICdEJyB9LFxuICAgIHsgY29kZTogJ0dORicsIG5hbWU6ICdHdWluZWFuIEZyYW5jJywgc3ltYm9sOiAnRkcnIH0sXG4gICAgeyBjb2RlOiAnS01GJywgbmFtZTogJ0NvbW9yaWFuIEZyYW5jJywgc3ltYm9sOiAnQ0YnIH0sXG4gICAgeyBjb2RlOiAnTFJEJywgbmFtZTogJ0xpYmVyaWFuIERvbGxhcicsIHN5bWJvbDogJ0wkJyB9LFxuICAgIHsgY29kZTogJ0xTTCcsIG5hbWU6ICdMZXNvdGhvIExvdGknLCBzeW1ib2w6ICdMJyB9LFxuICAgIHsgY29kZTogJ01HQScsIG5hbWU6ICdNYWxhZ2FzeSBBcmlhcnknLCBzeW1ib2w6ICdBcicgfSxcbiAgICB7IGNvZGU6ICdNUk8nLCBuYW1lOiAnTWF1cml0YW5pYW4gT3VndWl5YScsIHN5bWJvbDogJ1VNJyB9LFxuICAgIHsgY29kZTogJ01aTicsIG5hbWU6ICdNb3phbWJpY2FuIE1ldGljYWwnLCBzeW1ib2w6ICdNVCcgfSxcbiAgICB7IGNvZGU6ICdSV0YnLCBuYW1lOiAnUndhbmRhbiBGcmFuYycsIHN5bWJvbDogJ0ZSdycgfSxcbiAgICB7IGNvZGU6ICdTREcnLCBuYW1lOiAnU3VkYW5lc2UgUG91bmQnLCBzeW1ib2w6ICfYrC7Ysy4nIH0sXG4gICAgeyBjb2RlOiAnU0xMJywgbmFtZTogJ1NpZXJyYSBMZW9uZWFuIExlb25lJywgc3ltYm9sOiAnTGUnIH0sXG4gICAgeyBjb2RlOiAnU09TJywgbmFtZTogJ1NvbWFsaSBTaGlsbGluZycsIHN5bWJvbDogJ1MnIH0sXG4gICAgeyBjb2RlOiAnU1NQJywgbmFtZTogJ1NvdXRoIFN1ZGFuZXNlIFBvdW5kJywgc3ltYm9sOiAnwqMnIH0sXG4gICAgeyBjb2RlOiAnU1REJywgbmFtZTogJ1PDo28gVG9tw6kgYW5kIFByw61uY2lwZSBEb2JyYScsIHN5bWJvbDogJ0RiJyB9LFxuICAgIHsgY29kZTogJ1NaTCcsIG5hbWU6ICdTd2F6aSBMaWxhbmdlbmknLCBzeW1ib2w6ICdMJyB9LFxuICAgIHsgY29kZTogJ1RORCcsIG5hbWU6ICdUdW5pc2lhbiBEaW5hcicsIHN5bWJvbDogJ9ivLtiqJyB9LFxuICAgIHsgY29kZTogJ1RaUycsIG5hbWU6ICdUYW56YW5pYW4gU2hpbGxpbmcnLCBzeW1ib2w6ICdUU2gnIH0sXG4gICAgeyBjb2RlOiAnVUdYJywgbmFtZTogJ1VnYW5kYW4gU2hpbGxpbmcnLCBzeW1ib2w6ICdVU2gnIH0sXG4gICAgeyBjb2RlOiAnWEFGJywgbmFtZTogJ0NlbnRyYWwgQWZyaWNhbiBDRkEgRnJhbmMnLCBzeW1ib2w6ICdGQ0ZBJyB9LFxuICAgIHsgY29kZTogJ1hPRicsIG5hbWU6ICdXZXN0IEFmcmljYW4gQ0ZBIEZyYW5jJywgc3ltYm9sOiAnQ0ZBJyB9LFxuICAgIHsgY29kZTogJ1pNVycsIG5hbWU6ICdaYW1iaWFuIEt3YWNoYScsIHN5bWJvbDogJ1pLJyB9XG4gIF07XG4gIFxuICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGN1cnJlbmN5IGJ5IGNvZGVcbiAgZXhwb3J0IGZ1bmN0aW9uIGdldEN1cnJlbmN5QnlDb2RlKGNvZGU6IHN0cmluZyk6IEN1cnJlbmN5IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gQ09NTU9OX0NVUlJFTkNJRVMuZmluZChjID0+IGMuY29kZSA9PT0gY29kZSk7XG4gIH1cbiAgXG4gIC8vIFVwZGF0ZWQgZm9ybWF0IGN1cnJlbmN5IHdpdGggc3ltYm9sXG4gIGV4cG9ydCBmdW5jdGlvbiBmb3JtYXRDdXJyZW5jeShhbW91bnQ6IG51bWJlciwgY3VycmVuY3lDb2RlOiBzdHJpbmcgPSAnVVNEJyk6IHN0cmluZyB7XG4gICAgLy8gSWYgaXQncyBub3QgYSB2YWxpZCBjdXJyZW5jeSBjb2RlLCBkZWZhdWx0IHRvIFVTRFxuICAgIGlmICghQ09NTU9OX0NVUlJFTkNJRVMuc29tZShjID0+IGMuY29kZSA9PT0gY3VycmVuY3lDb2RlKSkge1xuICAgICAgY3VycmVuY3lDb2RlID0gJ1VTRCc7XG4gICAgfVxuICAgIFxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbmV3IEludGwuTnVtYmVyRm9ybWF0KCdlbi1VUycsIHtcbiAgICAgICAgc3R5bGU6ICdjdXJyZW5jeScsXG4gICAgICAgIGN1cnJlbmN5OiBjdXJyZW5jeUNvZGUsXG4gICAgICAgIGN1cnJlbmN5RGlzcGxheTogJ3N5bWJvbCdcbiAgICAgIH0pLmZvcm1hdChhbW91bnQpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBGYWxsYmFjayBpbiBjYXNlIG9mIGludmFsaWQgY3VycmVuY3kgY29kZVxuICAgICAgY29uc29sZS5lcnJvcihgSW52YWxpZCBjdXJyZW5jeSBjb2RlOiAke2N1cnJlbmN5Q29kZX1gLCBlcnJvcik7XG4gICAgICByZXR1cm4gbmV3IEludGwuTnVtYmVyRm9ybWF0KCdlbi1VUycsIHtcbiAgICAgICAgc3R5bGU6ICdjdXJyZW5jeScsXG4gICAgICAgIGN1cnJlbmN5OiAnVVNEJ1xuICAgICAgfSkuZm9ybWF0KGFtb3VudCk7XG4gICAgfVxuICB9XG4gIFxuICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IG1vbnRoIG5hbWUgZnJvbSBkYXRlXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXRNb250aE5hbWUoZGF0ZTogRGF0ZSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGRhdGUudG9Mb2NhbGVTdHJpbmcoJ2RlZmF1bHQnLCB7IG1vbnRoOiAnbG9uZycgfSk7XG4gIH1cbiAgXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgeWVhciBmcm9tIGRhdGVcbiAgZXhwb3J0IGZ1bmN0aW9uIGdldFllYXIoZGF0ZTogRGF0ZSk6IG51bWJlciB7XG4gICAgcmV0dXJuIGRhdGUuZ2V0RnVsbFllYXIoKTtcbiAgfVxuICBcbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBtb250aCBhbmQgeWVhciBzdHJpbmdcbiAgZXhwb3J0IGZ1bmN0aW9uIGdldE1vbnRoWWVhclN0cmluZyhkYXRlOiBEYXRlKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7Z2V0TW9udGhOYW1lKGRhdGUpfSAke2dldFllYXIoZGF0ZSl9YDtcbiAgfVxuICBcbiAgLy8gRGVmYXVsdCBleHBlbnNlIGNhdGVnb3JpZXNcbiAgZXhwb3J0IGNvbnN0IERFRkFVTFRfRVhQRU5TRV9DQVRFR09SSUVTOiBDYXRlZ29yeVtdID0gW1xuICAgIHsgaWQ6ICdmb29kJywgbmFtZTogJ0Zvb2QgJiBEaW5pbmcnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdncm9jZXJpZXMnLCBuYW1lOiAnR3JvY2VyaWVzJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAndHJhbnNwb3J0YXRpb24nLCBuYW1lOiAnVHJhbnNwb3J0YXRpb24nLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdyZW50JywgbmFtZTogJ1JlbnQvTW9ydGdhZ2UnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICd1dGlsaXRpZXMnLCBuYW1lOiAnVXRpbGl0aWVzJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAnaW50ZXJuZXQnLCBuYW1lOiAnSW50ZXJuZXQgJiBQaG9uZScsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ2VudGVydGFpbm1lbnQnLCBuYW1lOiAnRW50ZXJ0YWlubWVudCcsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ3Nob3BwaW5nJywgbmFtZTogJ1Nob3BwaW5nJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAnaGVhbHRoJywgbmFtZTogJ0hlYWx0aGNhcmUnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdlZHVjYXRpb24nLCBuYW1lOiAnRWR1Y2F0aW9uJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAndHJhdmVsJywgbmFtZTogJ1RyYXZlbCcsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ2ZpdG5lc3MnLCBuYW1lOiAnRml0bmVzcycsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ3BldHMnLCBuYW1lOiAnUGV0cycsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ2dpZnRzJywgbmFtZTogJ0dpZnRzICYgRG9uYXRpb25zJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAncGVyc29uYWwnLCBuYW1lOiAnUGVyc29uYWwgQ2FyZScsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ2NoaWxkY2FyZScsIG5hbWU6ICdDaGlsZGNhcmUnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdzdWJzY3JpcHRpb25zJywgbmFtZTogJ1N1YnNjcmlwdGlvbnMnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdpbnN1cmFuY2UnLCBuYW1lOiAnSW5zdXJhbmNlJywgdHlwZTogQ2F0ZWdvcnlUeXBlLkVYUEVOU0UgfSxcbiAgICB7IGlkOiAndGF4ZXMnLCBuYW1lOiAnVGF4ZXMnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICAgIHsgaWQ6ICdpbnRlcm5hbCcsIG5hbWU6ICdJbnRlcm5hbCcsIHR5cGU6IENhdGVnb3J5VHlwZS5FWFBFTlNFIH0sXG4gICAgeyBpZDogJ290aGVyX2V4cGVuc2UnLCBuYW1lOiAnT3RoZXIgRXhwZW5zZXMnLCB0eXBlOiBDYXRlZ29yeVR5cGUuRVhQRU5TRSB9LFxuICBdO1xuICBcbiAgLy8gRGVmYXVsdCBpbmNvbWUgY2F0ZWdvcmllc1xuICBleHBvcnQgY29uc3QgREVGQVVMVF9JTkNPTUVfQ0FURUdPUklFUzogQ2F0ZWdvcnlbXSA9IFtcbiAgICB7IGlkOiAnc2FsYXJ5JywgbmFtZTogJ1NhbGFyeScsIHR5cGU6IENhdGVnb3J5VHlwZS5JTkNPTUUgfSxcbiAgICB7IGlkOiAnZnJlZWxhbmNlJywgbmFtZTogJ0ZyZWVsYW5jZScsIHR5cGU6IENhdGVnb3J5VHlwZS5JTkNPTUUgfSxcbiAgICB7IGlkOiAnYnVzaW5lc3MnLCBuYW1lOiAnQnVzaW5lc3MnLCB0eXBlOiBDYXRlZ29yeVR5cGUuSU5DT01FIH0sXG4gICAgeyBpZDogJ2ludmVzdG1lbnRzJywgbmFtZTogJ0ludmVzdG1lbnRzJywgdHlwZTogQ2F0ZWdvcnlUeXBlLklOQ09NRSB9LFxuICAgIHsgaWQ6ICdkaXZpZGVuZHMnLCBuYW1lOiAnRGl2aWRlbmRzJywgdHlwZTogQ2F0ZWdvcnlUeXBlLklOQ09NRSB9LFxuICAgIHsgaWQ6ICdyZW50YWwnLCBuYW1lOiAnUmVudGFsIEluY29tZScsIHR5cGU6IENhdGVnb3J5VHlwZS5JTkNPTUUgfSxcbiAgICB7IGlkOiAnZ2lmdHNfcmVjZWl2ZWQnLCBuYW1lOiAnR2lmdHMgUmVjZWl2ZWQnLCB0eXBlOiBDYXRlZ29yeVR5cGUuSU5DT01FIH0sXG4gICAgeyBpZDogJ3RheF9yZXR1cm5zJywgbmFtZTogJ1RheCBSZXR1cm5zJywgdHlwZTogQ2F0ZWdvcnlUeXBlLklOQ09NRSB9LFxuICAgIHsgaWQ6ICdvdGhlcl9pbmNvbWUnLCBuYW1lOiAnT3RoZXIgSW5jb21lJywgdHlwZTogQ2F0ZWdvcnlUeXBlLklOQ09NRSB9LFxuICBdO1xuXG4gIGV4cG9ydCBjb25zdCBERUZBVUxUX0NBVEVHT1JZX0VNT0pJUzogQ2F0ZWdvcnlFbW9qaVNldHRpbmdzID0ge1xuICAgIGZvb2Q6ICfwn42UJyxcbiAgICBncm9jZXJpZXM6ICfwn6WRJyxcbiAgICB0cmFuc3BvcnRhdGlvbjogJ/CfmpcnLFxuICAgIHJlbnQ6ICfwn5SRJyxcbiAgICB1dGlsaXRpZXM6ICfwn5KhJyxcbiAgICBpbnRlcm5ldDogJ/Cfk7EnLFxuICAgIGVudGVydGFpbm1lbnQ6ICfwn46uJyxcbiAgICBzaG9wcGluZzogJ/Cfm43vuI8nLFxuICAgIGhlYWx0aDogJ/CfkponLFxuICAgIGVkdWNhdGlvbjogJ/CfjpMnLFxuICAgIHRyYXZlbDogJ+KciO+4jycsXG4gICAgZml0bmVzczogJ/CfkZ8nLFxuICAgIHBldHM6ICfwn5C2JyxcbiAgICBnaWZ0czogJ/CfjoEnLFxuICAgIHBlcnNvbmFsOiAn4pyC77iPJyxcbiAgICBjaGlsZGNhcmU6ICfwn428JyxcbiAgICBzdWJzY3JpcHRpb25zOiAn8J+SsycsXG4gICAgaW5zdXJhbmNlOiAn4piC77iPJyxcbiAgICB0YXhlczogJ/Cfk50nLFxuICAgIGludGVybmFsOiAn8J+UgScsXG4gICAgb3RoZXJfZXhwZW5zZTogJ/CfpLfigI3imYLvuI8nLFxuICAgIHNhbGFyeTogJ/CfkrUnLFxuICAgIGZyZWVsYW5jZTogJ/CfkrsnLFxuICAgIGJ1c2luZXNzOiAn8J+PoicsXG4gICAgaW52ZXN0bWVudHM6ICfwn5OIJyxcbiAgICBkaXZpZGVuZHM6ICfwn5KwJyxcbiAgICByZW50YWw6ICfwn4+Y77iPJyxcbiAgICBnaWZ0c19yZWNlaXZlZDogJ/CfjoAnLFxuICAgIHRheF9yZXR1cm5zOiAn8J+TiycsXG4gICAgb3RoZXJfaW5jb21lOiAn8J+SuCdcbiAgfTtcbiAgXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXRDb21tb25DYXRlZ29yeUVtb2ppcyh0eXBlOiBDYXRlZ29yeVR5cGUpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZW1vamlzID0gREVGQVVMVF9DQVRFR09SSUVTXG4gICAgICAuZmlsdGVyKGNhdGVnb3J5ID0+IGNhdGVnb3J5LnR5cGUgPT09IHR5cGUpXG4gICAgICAubWFwKGNhdGVnb3J5ID0+IERFRkFVTFRfQ0FURUdPUllfRU1PSklTW2NhdGVnb3J5LmlkXSlcbiAgICAgIC5maWx0ZXIoKGVtb2ppKTogZW1vamkgaXMgc3RyaW5nID0+ICEhZW1vamkpO1xuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldChlbW9qaXMpKTtcbiAgfVxuXG4gIC8vIENvbWJpbmUgYWxsIGRlZmF1bHQgY2F0ZWdvcmllc1xuICBleHBvcnQgY29uc3QgREVGQVVMVF9DQVRFR09SSUVTOiBDYXRlZ29yeVtdID0gW1xuICAgIC4uLkRFRkFVTFRfRVhQRU5TRV9DQVRFR09SSUVTLFxuICAgIC4uLkRFRkFVTFRfSU5DT01FX0NBVEVHT1JJRVNcbiAgXTtcbiAgXG4gIGV4cG9ydCBlbnVtIEJ1ZGdldFBlcmlvZCB7XG4gICAgTU9OVEhMWSA9ICdtb250aGx5JyxcbiAgICBRVUFSVEVSTFkgPSAncXVhcnRlcmx5JyxcbiAgICBZRUFSTFkgPSAneWVhcmx5J1xuICB9XG4gIFxuICBleHBvcnQgaW50ZXJmYWNlIEJ1ZGdldCB7XG4gICAgaWQ6IHN0cmluZztcbiAgICBjYXRlZ29yeUlkOiBzdHJpbmc7XG4gICAgYW1vdW50OiBudW1iZXI7XG4gICAgcGVyaW9kOiBCdWRnZXRQZXJpb2Q7XG4gICAgcm9sbG92ZXI6IGJvb2xlYW47XG4gICAgbGFzdFVwZGF0ZWQ6IHN0cmluZztcbiAgfVxuICBcbiAgZXhwb3J0IGludGVyZmFjZSBCdWRnZXREYXRhIHtcbiAgICBidWRnZXRzOiBCdWRnZXRbXTtcbiAgICBsYXN0VXBkYXRlZDogc3RyaW5nOyAvLyBJU08gdGltZXN0YW1wXG4gIH1cbiAgXG4gIGV4cG9ydCBjb25zdCBERUZBVUxUX0JVREdFVF9EQVRBOiBCdWRnZXREYXRhID0ge1xuICAgIGJ1ZGdldHM6IFtdLFxuICAgIGxhc3RVcGRhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgfTtcbiAgXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjYWxjdWxhdGUgYnVkZ2V0IHN0YXR1c1xuICBleHBvcnQgZnVuY3Rpb24gY2FsY3VsYXRlQnVkZ2V0U3RhdHVzKFxuICAgIGJ1ZGdldDogQnVkZ2V0LCBcbiAgICB0cmFuc2FjdGlvbnM6IFRyYW5zYWN0aW9uW10sIFxuICAgIGN1cnJlbnREYXRlOiBEYXRlID0gbmV3IERhdGUoKVxuICApOiB7IHNwZW50OiBudW1iZXI7IHJlbWFpbmluZzogbnVtYmVyOyBwZXJjZW50YWdlOiBudW1iZXIgfSB7XG4gICAgXG4gICAgLy8gR2V0IHN0YXJ0IGFuZCBlbmQgZGF0ZSBmb3IgdGhlIGJ1ZGdldCBwZXJpb2RcbiAgICBjb25zdCB7IHN0YXJ0RGF0ZSwgZW5kRGF0ZSB9ID0gZ2V0QnVkZ2V0UGVyaW9kRGF0ZXMoYnVkZ2V0LnBlcmlvZCwgY3VycmVudERhdGUpO1xuICAgIFxuICAgIC8vIEZpbHRlciB0cmFuc2FjdGlvbnMgZm9yIHRoaXMgY2F0ZWdvcnkgaW4gdGhlIGN1cnJlbnQgcGVyaW9kXG4gICAgY29uc3QgcGVyaW9kVHJhbnNhY3Rpb25zID0gdHJhbnNhY3Rpb25zLmZpbHRlcih0ID0+IFxuICAgICAgdC5jYXRlZ29yeSA9PT0gYnVkZ2V0LmNhdGVnb3J5SWQgJiYgXG4gICAgICB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFICYmXG4gICAgICBwYXJzZUxvY2FsRGF0ZSh0LmRhdGUpID49IHN0YXJ0RGF0ZSAmJlxuICAgICAgcGFyc2VMb2NhbERhdGUodC5kYXRlKSA8PSBlbmREYXRlXG4gICAgKTtcbiAgICBcbiAgICAvLyBDYWxjdWxhdGUgaG93IG11Y2ggd2FzIHNwZW50XG4gICAgY29uc3Qgc3BlbnQgPSBwZXJpb2RUcmFuc2FjdGlvbnMucmVkdWNlKCh0b3RhbCwgdCkgPT4gdG90YWwgKyB0LmFtb3VudCwgMCk7XG4gICAgXG4gICAgLy8gQ2FsY3VsYXRlIHJlbWFpbmluZyBidWRnZXQgYW5kIHBlcmNlbnRhZ2VcbiAgICBjb25zdCByZW1haW5pbmcgPSBNYXRoLm1heCgwLCBidWRnZXQuYW1vdW50IC0gc3BlbnQpO1xuICAgIGNvbnN0IHBlcmNlbnRhZ2UgPSBidWRnZXQuYW1vdW50ID4gMCA/IE1hdGgubWluKDEwMCwgKHNwZW50IC8gYnVkZ2V0LmFtb3VudCkgKiAxMDApIDogMDtcbiAgICBcbiAgICByZXR1cm4geyBzcGVudCwgcmVtYWluaW5nLCBwZXJjZW50YWdlIH07XG4gIH1cbiAgXG4gIC8vIEdldCB0aGUgZGF0ZSByYW5nZSBmb3IgYSBidWRnZXQgcGVyaW9kXG4gIGV4cG9ydCBmdW5jdGlvbiBnZXRCdWRnZXRQZXJpb2REYXRlcyhwZXJpb2Q6IEJ1ZGdldFBlcmlvZCwgY3VycmVudERhdGU6IERhdGUgPSBuZXcgRGF0ZSgpKTogeyBzdGFydERhdGU6IERhdGUsIGVuZERhdGU6IERhdGUgfSB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoY3VycmVudERhdGUpO1xuICAgIGxldCBzdGFydERhdGU6IERhdGU7XG4gICAgbGV0IGVuZERhdGU6IERhdGU7XG4gICAgXG4gICAgc3dpdGNoKHBlcmlvZCkge1xuICAgICAgY2FzZSBCdWRnZXRQZXJpb2QuTU9OVEhMWTpcbiAgICAgICAgc3RhcnREYXRlID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxKTtcbiAgICAgICAgZW5kRGF0ZSA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSArIDEsIDApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgQnVkZ2V0UGVyaW9kLlFVQVJURVJMWTpcbiAgICAgICAgY29uc3QgcXVhcnRlciA9IE1hdGguZmxvb3Iobm93LmdldE1vbnRoKCkgLyAzKTtcbiAgICAgICAgc3RhcnREYXRlID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIHF1YXJ0ZXIgKiAzLCAxKTtcbiAgICAgICAgZW5kRGF0ZSA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCAocXVhcnRlciArIDEpICogMywgMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBCdWRnZXRQZXJpb2QuWUVBUkxZOlxuICAgICAgICBzdGFydERhdGUgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgMCwgMSk7XG4gICAgICAgIGVuZERhdGUgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgMTEsIDMxKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBzdGFydERhdGUgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDEpO1xuICAgICAgICBlbmREYXRlID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpICsgMSwgMCk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiB7IHN0YXJ0RGF0ZSwgZW5kRGF0ZSB9O1xuICB9XG4gIFxuICAvLyBIZWxwZXIgY2xhc3MgZm9yIGFnZ3JlZ2F0aW5nIHRyYW5zYWN0aW9uIGRhdGFcbiAgZXhwb3J0IGNsYXNzIFRyYW5zYWN0aW9uQWdncmVnYXRvciB7XG4gICAgc3RhdGljIGdldFRvdGFsSW5jb21lKHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXSk6IG51bWJlciB7XG4gICAgICByZXR1cm4gdHJhbnNhY3Rpb25zXG4gICAgICAgIC5maWx0ZXIodCA9PiB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTkNPTUUpXG4gICAgICAgIC5yZWR1Y2UoKHN1bSwgdCkgPT4gc3VtICsgdC5hbW91bnQsIDApO1xuICAgIH1cbiAgXG4gICAgc3RhdGljIGdldFRvdGFsRXhwZW5zZXModHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdKTogbnVtYmVyIHtcbiAgICAgIHJldHVybiB0cmFuc2FjdGlvbnNcbiAgICAgICAgLmZpbHRlcih0ID0+IHQudHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLkVYUEVOU0UpXG4gICAgICAgIC5yZWR1Y2UoKHN1bSwgdCkgPT4gc3VtICsgdC5hbW91bnQsIDApO1xuICAgIH1cbiAgXG4gICAgc3RhdGljIGdldEJhbGFuY2UodHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdKTogbnVtYmVyIHtcbiAgICAgIHJldHVybiB0aGlzLmdldFRvdGFsSW5jb21lKHRyYW5zYWN0aW9ucykgLSB0aGlzLmdldFRvdGFsRXhwZW5zZXModHJhbnNhY3Rpb25zKTtcbiAgICB9XG4gIFxuICAgIHN0YXRpYyBnZXRFeHBlbnNlc0J5Q2F0ZWdvcnkodHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdLCBjYXRlZ29yaWVzOiBDYXRlZ29yeVtdKTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiB7XG4gICAgICBjb25zdCBleHBlbnNlczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgdHJhbnNhY3Rpb25zXG4gICAgICAgIC5maWx0ZXIodCA9PiB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFKVxuICAgICAgICAuZm9yRWFjaCh0ID0+IHtcbiAgICAgICAgICBjb25zdCBjYXRlZ29yeSA9IGNhdGVnb3JpZXMuZmluZChjID0+IGMuaWQgPT09IHQuY2F0ZWdvcnkpO1xuICAgICAgICAgIGNvbnN0IGNhdGVnb3J5TmFtZSA9IGNhdGVnb3J5ID8gY2F0ZWdvcnkubmFtZSA6ICdPdGhlciBFeHBlbnNlcyc7XG4gICAgICAgICAgaWYgKCFleHBlbnNlc1tjYXRlZ29yeU5hbWVdKSB7XG4gICAgICAgICAgICBleHBlbnNlc1tjYXRlZ29yeU5hbWVdID0gMDtcbiAgICAgICAgICB9XG4gICAgICAgICAgZXhwZW5zZXNbY2F0ZWdvcnlOYW1lXSArPSB0LmFtb3VudDtcbiAgICAgICAgfSk7XG4gICAgICByZXR1cm4gZXhwZW5zZXM7XG4gICAgfVxuICBcbiAgICBzdGF0aWMgZ2V0VHJhbnNhY3Rpb25zQnlEYXRlKHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXSk6IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uW10+IHtcbiAgICAgIGNvbnN0IGJ5RGF0ZTogUmVjb3JkPHN0cmluZywgVHJhbnNhY3Rpb25bXT4gPSB7fTtcbiAgICAgIHRyYW5zYWN0aW9ucy5mb3JFYWNoKHQgPT4ge1xuICAgICAgICBjb25zdCBkYXRlU3RyID0gdC5kYXRlLnN1YnN0cmluZygwLCAxMCk7IC8vIEdldCBZWVlZLU1NLUREIHBhcnRcbiAgICAgICAgaWYgKCFieURhdGVbZGF0ZVN0cl0pIHtcbiAgICAgICAgICBieURhdGVbZGF0ZVN0cl0gPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBieURhdGVbZGF0ZVN0cl0ucHVzaCh0KTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGJ5RGF0ZTtcbiAgICB9XG4gIFxuICAgIHN0YXRpYyBnZXRUcmFuc2FjdGlvbnNCeU1vbnRoKHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXSk6IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uW10+IHtcbiAgICAgIGNvbnN0IGJ5TW9udGg6IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uW10+ID0ge307XG4gICAgICB0cmFuc2FjdGlvbnMuZm9yRWFjaCh0ID0+IHtcbiAgICAgICAgY29uc3QgbW9udGhTdHIgPSB0LmRhdGUuc3Vic3RyaW5nKDAsIDcpOyAvLyBHZXQgWVlZWS1NTSBwYXJ0XG4gICAgICAgIGlmICghYnlNb250aFttb250aFN0cl0pIHtcbiAgICAgICAgICBieU1vbnRoW21vbnRoU3RyXSA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGJ5TW9udGhbbW9udGhTdHJdLnB1c2godCk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBieU1vbnRoO1xuICAgIH1cbiAgfVxuIl19