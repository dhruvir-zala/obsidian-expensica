# Expensica

Expensica tracks income and expenses inside Obsidian. Add a transaction, check where the money went, then get back to whatever you were doing. Your data lives in your vault, not in another finance app asking you to make an account.

## Install

1. In Obsidian, open **Settings → Community plugins** and turn off Safe mode.
2. Choose **Browse**, search for **Expensica**, then install and enable it.
3. Open the dashboard from the ribbon icon or the Command palette.

You can also assign hotkeys to Expensica commands in Obsidian's Hotkeys settings.

## What it does

- Record and edit income, expenses, and transfers between accounts.
- Review balances, transactions, budgets, and spending by category.
- Filter transaction history and search descriptions.
- See spending on a calendar heatmap, then select a day to inspect it.
- Make categories your own with names, colors, and emoji.
- Export transactions as JSON, CSV, or PDF. Import transactions from JSON.
- Create a daily finance review as a Markdown note in your vault.

![Adding a transaction in Expensica](assets/Adding%20a%20transaction%20in%20Expensica.gif)

![Spending heatmap calendar in Expensica](assets/Spending%20heatmap%20calendar%20in%20Expensica.gif)

## Your data

Expensica stores its files in `expensica-data` in your vault:

- `transactions.json` for transactions
- `accounts.json` for accounts
- `budgets.json` for budgets

These are ordinary JSON files, so you can back them up with the rest of your vault. If you sync your vault between devices, these files go along with it. That's vault sync, not bank sync.

## A couple of limits

Expensica doesn't connect to banks or fetch transactions for you. You'll need to enter them yourself, or import a JSON file. It's for everyday income and expenses, not investment tracking or tax preparation.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT. See [LICENSE](LICENSE).

## About

Expensica is made by [Dhruvir Zala](https://dhruvirzala.com/).

- [LinkedIn](https://www.linkedin.com/in/dhruvir-zala/)
- [Twitter](https://twitter.com/DhruvirZala)
- [Buy me a coffee](https://ko-fi.com/X8X71DLZHF)
